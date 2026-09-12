/**
 * MPPT Journal - Cloudflare Edge API & R2 Storage Worker
 * Handles secure author manuscript uploads, presigned access, and health checks.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Handle CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // 2. Health check
    if (url.pathname === '/' || url.pathname === '/health' || url.pathname === '/api/health') {
      return jsonResponse({
        service: 'mppt-api',
        journal: 'Modern Pharmacy Praxis & Therapeutics',
        status: 'online',
        r2_bucket: 'mppt-manuscripts',
        timestamp: new Date().toISOString()
      });
    }

    // 3. Upload endpoint (POST /upload or /api/upload)
    if (request.method === 'POST' && (url.pathname === '/upload' || url.pathname === '/api/upload')) {
      try {
        const contentType = request.headers.get('content-type') || '';
        if (!contentType.includes('multipart/form-data')) {
          return jsonResponse({ success: false, error: 'Content-Type must be multipart/form-data' }, 400);
        }

        const formData = await request.formData();
        const file = formData.get('file');
        const paperId = (formData.get('paperId') || 'MPPT-PENDING').replace(/[^a-zA-Z0-9_-]/g, '');
        const authorEmail = (formData.get('authorEmail') || '').toLowerCase().trim();
        const manuscriptTitle = formData.get('title') || '';

        if (!file || typeof file === 'string') {
          return jsonResponse({ success: false, error: 'No manuscript file uploaded' }, 400);
        }

        // Validate file size (max 50 MB)
        const MAX_SIZE = 50 * 1024 * 1024;
        if (file.size > MAX_SIZE) {
          return jsonResponse({ success: false, error: 'File exceeds 50 MB limit' }, 413);
        }

        // Sanitize file name
        const origName = file.name || 'manuscript.pdf';
        const ext = origName.split('.').pop().toLowerCase();
        const allowedExts = ['pdf', 'docx', 'doc'];
        if (!allowedExts.includes(ext)) {
          return jsonResponse({ success: false, error: 'Invalid file extension. Only .pdf, .docx, and .doc are permitted.' }, 400);
        }

        const safeBaseName = origName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const r2Key = `manuscripts/${paperId}/${Date.now()}_${safeBaseName}`;

        // Store into R2
        await env.MANUSCRIPTS.put(r2Key, file.stream(), {
          httpMetadata: {
            contentType: file.type || (ext === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
            contentDisposition: `attachment; filename="${safeBaseName}"`,
          },
          customMetadata: {
            paperId,
            authorEmail,
            originalName: safeBaseName,
            title: manuscriptTitle.substring(0, 100),
            uploadedAt: new Date().toISOString(),
          },
        });

        const downloadUrl = `${url.origin}/download/${encodeURIComponent(r2Key)}`;

        return jsonResponse({
          success: true,
          message: 'Manuscript uploaded to R2 cloud storage',
          paperId,
          r2Key,
          fileName: safeBaseName,
          fileSize: file.size,
          downloadUrl
        }, 201);

      } catch (err) {
        return jsonResponse({ success: false, error: 'Upload failed: ' + err.message }, 500);
      }
    }

    // 4. Download endpoint (GET /download/:key)
    if (request.method === 'GET' && url.pathname.startsWith('/download/')) {
      const rawKey = url.pathname.replace('/download/', '');
      const r2Key = decodeURIComponent(rawKey);

      if (!r2Key) {
        return jsonResponse({ success: false, error: 'Missing file key' }, 400);
      }

      const object = await env.MANUSCRIPTS.get(r2Key);
      if (!object) {
        return jsonResponse({ success: false, error: 'File not found in R2 storage' }, 404);
      }

      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('etag', object.httpEtag);
      headers.set('Cache-Control', 'private, max-age=86400');
      headers.set('Access-Control-Allow-Origin', '*');

      return new Response(object.body, { headers });
    }

    // 5. Query manuscript files (GET /manuscripts/:paperId)
    if (request.method === 'GET' && url.pathname.startsWith('/manuscripts/')) {
      const paperId = url.pathname.replace('/manuscripts/', '').trim();
      if (!paperId) return jsonResponse({ success: false, error: 'Missing paper ID' }, 400);

      const list = await env.MANUSCRIPTS.list({ prefix: `manuscripts/${paperId}/` });
      const files = list.objects.map(o => ({
        key: o.key,
        size: o.size,
        uploaded: o.uploaded,
        downloadUrl: `${url.origin}/download/${encodeURIComponent(o.key)}`
      }));

      return jsonResponse({ success: true, paperId, files });
    }

    return jsonResponse({ error: 'Endpoint not found' }, 404);
  }
};
