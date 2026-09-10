#!/usr/bin/env python3
"""
MPPT Journal - Video to Scroll Frames Auto-Extractor
===================================================
How to use in the future:
1. Drop any 3-5 second video named 'video.mp4' (or 'video.webm') into this folder.
2. Run this script: python update_video.py
3. It will automatically extract and compress 120 high-definition WebP frames into /frames/
   ready for the website scroll engine without touching any website code!
"""

import os
import sys
import subprocess
import shutil

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRAMES_DIR = os.path.join(BASE_DIR, "frames")
TARGET_FRAMES = 120

def find_video():
    candidates = ["video.mp4", "video.webm", "video.mov", "cinematic.mp4", "scroll.mp4"]
    for c in candidates:
        p = os.path.join(BASE_DIR, c)
        if os.path.exists(p):
            return p
    return None

def main():
    video_path = find_video()
    if not video_path:
        print("❌ No video file found!")
        print("Please place your video as 'video.mp4' in this folder and run again:")
        print(f"Folder: {BASE_DIR}")
        sys.exit(1)

    print(f"🎬 Found video: {os.path.basename(video_path)}")
    os.makedirs(FRAMES_DIR, exist_ok=True)

    # Use ffmpeg to get video duration and extract exactly TARGET_FRAMES
    print(f"⚙️ Extracting and compressing {TARGET_FRAMES} frames as WebP...")
    
    # FFmpeg command to extract exactly 120 frames at 1920x1080 WebP quality 85
    # Using fps filter or select filter
    cmd = [
        "ffmpeg", "-y", "-i", video_path,
        "-vf", f"scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080",
        "-vframes", str(TARGET_FRAMES),
        "-c:v", "libwebp",
        "-quality", "85",
        os.path.join(FRAMES_DIR, "frame_%04d.webp")
    ]

    try:
        subprocess.run(cmd, check=True)
        print("✅ Frame extraction complete!")
        
        # Verify count
        frames = [f for f in os.listdir(FRAMES_DIR) if f.startswith("frame_") and f.endswith(".webp")]
        print(f"🚀 Total frames generated in /frames/: {len(frames)}")
        print("✨ Your website scroll animation is now updated with the new video!")
    except Exception as e:
        print(f"⚠️ FFmpeg error: {e}")
        print("Falling back to OpenCV Python...")
        try:
            import cv2
            cap = cv2.VideoCapture(video_path)
            total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            step = max(1, total // TARGET_FRAMES)
            
            f_idx = 1
            cur = 0
            while cap.isOpened() and f_idx <= TARGET_FRAMES:
                ret, frame = cap.read()
                if not ret:
                    break
                if cur % step == 0:
                    frame_resized = cv2.resize(frame, (1920, 1080))
                    out_p = os.path.join(FRAMES_DIR, f"frame_{f_idx:04d}.webp")
                    cv2.imwrite(out_p, frame_resized, [cv2.IMWRITE_WEBP_QUALITY, 85])
                    f_idx += 1
                cur += 1
            cap.release()
            print(f"✅ OpenCV extracted {f_idx - 1} frames successfully!")
        except Exception as err:
            print(f"❌ Extraction failed: {err}")

if __name__ == "__main__":
    main()
