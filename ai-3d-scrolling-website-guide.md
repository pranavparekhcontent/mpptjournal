# AI-Assisted Developer Guide: Building Interactive 3D Scroll-Driven Websites
*Optimised for LLM/AI consumption, prompt generation, and direct code implementation.*

---

## 1. System Architecture & Tech Stack

To build a high-performance, cinematic, scroll-driven website featuring interactive WebGL 3D elements, use the following production-grade technical stack:

- **Framework**: Next.js (App Router or Pages Router)
- **Styling**: Tailwind CSS
- **3D Rendering**: Three.js, React Three Fiber (R3F), and `@react-three/drei`
- **Animations & Scrolling**: Custom high-performance `<canvas>` frame-rendering logic or GSAP (GreenSock Animation Platform) + ScrollTrigger
- **AI Web IDE / Editor**: Cursor, Antigravity, or VS Code with Copilot / Gemini Code Assist
- **AI Image & Video Generation**: Runnable (or Midjourney / Kling AI 2.5 / Runway Gen-3)
- **AI 3D Generation**: Tripo3D (or Meshy / Luma Genie)
- **Asset Processing**: EZGIF (for frame extraction), ChatGPT/Gemini (for image background removal & prompt writing)

---

## 2. Directory Structure

Ensure the Next.js project layout is structured as follows for the AI Agent to locate files reliably:

```text
my-3d-scrolling-site/
├── public/
│   ├── frames/                    # Extracted sequential frame images
│   │   ├── frame_0001.png
│   │   ├── frame_0002.png
│   │   └── ...
│   ├── 3d-model/
│   │   └── product_model.glb      # AI-generated GLTF Binary 3D model
│   └── frames.zip                 # Compressed backup of video frames
├── src/
│   ├── components/
│   │   ├── HeroSection.jsx        # Scroll-driven frame animation and text overlays
│   │   ├── LogoCarousel.jsx       # Infinite marquee logo carousel
│   │   ├── BentoGrid.jsx          # Feature cards layout
│   │   └── ModelViewer.jsx        # Live WebGL Three.js component
│   └── app/
│       ├── layout.js
│       └── page.js                # Core landing page assembling all components
└── package.json
```

---

## 3. Step-by-Step Production Workflow

### Phase 1: Creating the Cinematic Scroll Animation (Frame-by-Frame Method)
Instead of rendering complex, heavy 3D environments live on the GPU (which degrades performance on low-end devices), the "cinematic scroll" effect uses **pre-rendered video frame-swapping**.

1. **Inspiration & Visual Direction**: Locate starting and ending reference frames (e.g., from Dribbble or Pinterest).
2. **Keyframe Alignment**:
   - Upload the **Starting Frame** to an image editor/enhancer (e.g., Runnable, Midjourney).
   - Upscale, clean, and convert to a **16:9 aspect ratio**.
   - Upload the **Ending Frame**. Request the AI to modify its lighting, colors, and styling to perfectly match the Starting Frame while maintaining a 16:9 ratio.
3. **Cinematic Video Generation (Image-to-Video)**:
   - Use an advanced video model (e.g., **Kling 2.5** or **Runway Gen-3**).
   - Feed both the Starting and Ending frames as **first and last frame references** (or generate a highly-steered transition from the start image to the end image).
   - **Video Generation Prompt Pattern**:
     > `"A continuous, flawless, slow-motion cinematic camera dolly-in. Smooth transitional lighting, tracking forward from the starting image [Image 1] and arriving perfectly at the ending image [Image 2]. Ensure consistent geometry, high-fidelity details, volumetric lighting, and zero abrupt cuts. Video length: 4 to 5 seconds."`
4. **Frame Extraction**:
   - Extract the generated MP4 video into individual frames (aim for 100–150 sequential images to balance smooth scroll performance and file size).
   - Rename them sequentially (e.g., `frame_0001.png` to `frame_0120.png`).
   - Compress the frames folder into `frames.zip` or save them under `/public/frames/`.

---

### Phase 2: Frontend Setup & Structural Layout

1. **Next.js Initialization**:
   ```bash
   npx create-next-app@latest my-3d-scrolling-site --js --tailwind --eslint
   ```
2. **Design-Driven Layout Generation**:
   Provide the AI Editor with screenshots of high-quality UI references (e.g., Bento layouts, hero layouts from Pinterest) alongside the prompt.
3. **Refining the Layout**:
   Isolate the Hero UI text. Ensure the central hero section container is completely transparent with no background elements, leaving it prepared to sit on top of the animation canvas.

---

### Phase 3: Implementing the Scroll-Driven Frame Animation (Canvas-Based)

The scroll engine works by mapping the viewport’s scroll progress to a computed frame index, loading the matching pre-rendered frame, and drawing it dynamically to a fullscreen `<canvas>`.

#### Key Implementation Logic for the AI Agent:
```javascript
import React, { useEffect, useRef } from 'react';

export default function ScrollCanvasAnimation({ totalFrames = 120 }) {
  const canvasRef = useRef(null);
  const contextRef = useRef(null);
  const imagesRef = useRef([]);

  // Preload frames to prevent flickering during scroll
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    contextRef.current = context;

    // Load all images into memory
    for (let i = 1; i <= totalFrames; i++) {
      const img = new Image();
      // Format number to match 4-digit sequence (e.g., 0001, 0012, 0120)
      const frameNum = String(i).padStart(4, '0');
      img.src = `/frames/frame_${frameNum}.png`;
      imagesRef.current.push(img);
    }

    // Set canvas dimensions to viewport
    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      renderFrame(1);
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => window.removeEventListener('resize', handleResize);
  }, [totalFrames]);

  const renderFrame = (index) => {
    const img = imagesRef.current[index - 1];
    const canvas = canvasRef.current;
    const context = contextRef.current;

    if (img && canvas && context) {
      // Calculate object-fit cover dimensions
      const canvasRatio = canvas.width / canvas.height;
      const imgRatio = img.width / img.height;
      let drawWidth, drawHeight, offsetX, offsetY;

      if (canvasRatio > imgRatio) {
        drawWidth = canvas.width;
        drawHeight = canvas.width / imgRatio;
        offsetX = 0;
        offsetY = (canvas.height - drawHeight) / 2;
      } else {
        drawWidth = canvas.height * imgRatio;
        drawHeight = canvas.height;
        offsetX = (canvas.width - drawWidth) / 2;
        offsetY = 0;
      }

      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
    }
  };

  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const scrollFraction = scrollTop / maxScroll;
      
      // Calculate frame index based on scroll position
      const frameIndex = Math.min(
        totalFrames,
        Math.max(1, Math.ceil(scrollFraction * totalFrames))
      );

      requestAnimationFrame(() => renderFrame(frameIndex));
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [totalFrames]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed top-0 left-0 w-full h-full object-cover -z-10 pointer-events-none"
    />
  );
}
```

---

### Phase 4: Constructing & Texturing the 3D Model with AI

To include a bespoke interactive 3D component (e.g., an astronaut, a product, or a complex geometric piece) without manual 3D modeling:

1. **Source Image Customisation**:
   - Start with a detailed 2D image.
   - Use an LLM tool (e.g., ChatGPT/Gemini) to isolate the object, completely remove the background, erase distracting elements (like ladders, ground planes, or shadows), and produce a transparent PNG.
2. **AI 3D Mesh Generation (e.g., Tripo3D)**:
   - Upload the cleaned transparent PNG.
   - Select **Best Quality / Clean Topology** modes.
   - Run **Multi-View Synthesis** and **Smart Mesh Generation** for correct proportions.
   - Click **Texture** to bake realistic lighting and material properties directly onto the model.
   - Export the completed asset in `.glb` (GLTF Binary) format for seamless Web integration.

---

### Phase 5: Live WebGL 3D Model Integration

Place the `.glb` file inside the public directory (e.g., `/public/3d-model/astronaut.glb`). Use React Three Fiber to mount and control the WebGL Canvas.

#### 3D Canvas React Component:
```javascript
import React, { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stage, useGLTF } from '@react-three/drei';

function Model({ url }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} scale={1.5} />;
}

export default function ModelViewer({ modelUrl = "/3d-model/astronaut.glb" }) {
  return (
    <div className="w-full h-[500px] bg-transparent rounded-2xl overflow-hidden cursor-grab active:cursor-grabbing">
      <Canvas dpr={[1, 2]} camera={{ fov: 45 }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[10, 10, 5]} intensity={1.5} />
        <Suspense fallback={null}>
          <Stage environment="city" intensity={0.6}>
            <Model url={modelUrl} />
          </Stage>
        </Suspense>
        <OrbitControls 
          enableZoom={true} 
          enablePan={false} 
          maxPolarAngle={Math.PI / 2} 
          minPolarAngle={Math.PI / 4} 
        />
      </Canvas>
    </div>
  );
}
```

---

## 4. Operational Prompts for AI IDEs & Coding Agents

Copy and adapt these prompts directly into Cursor, Antigravity, or Copilot to execute individual components of this layout.

### Prompt 1: Initial Hero Structure & Styling
> `"Create a Next.js component called 'HeroSection.jsx' using Tailwind CSS. It must replicate the structure of a premium web page: a centered cinematic header, bold typography, glassmorphism call-to-action buttons, and side-aligned stats. Important: Remove any background colours, gradients, or image placeholders from the main containers. Make everything transparent, as we will overlay this entire UI on top of a fixed scroll-driven canvas animation."`

### Prompt 2: High-Performance Canvas Scroll Animation
> `"Implement high-performance scroll-driven animation in 'ScrollCanvasAnimation.jsx' using Next.js. Create a `<canvas>` element fixed at the back (-z-10). In useEffect, pre-load 120 images located at '/frames/frame_[0001-0120].png' to avoid flickering. Write an efficient window scroll event listener that maps the viewport scroll percentage to the current frame index (1 to 120). Render frames on the canvas using requestAnimationFrame, resizing dynamically to fill the screen with 'object-fit: cover' logic. Wrap this component safely to support Next.js SSR."`

### Prompt 3: Infinite Marquee Logo Carousel
> `"Write a React component 'LogoCarousel.jsx' with an infinite marquee effect. It must contain two horizontal rows of logos. The first row must glide smoothly from right to left, and the second row from left to right. Implement the seamless scrolling purely in CSS keyframes using Tailwind's arbitrary class extensions (or custom CSS inside globals.css). Set the logos to a minimalist monochrome styling (monotone white/gray) and strip any surrounding container borders or backgrounds."`

### Prompt 4: R3F GLB Model Viewer Integration
> `"Create an interactive WebGL component 'ModelViewer.jsx' using '@react-three/fiber' and '@react-three/drei'. Implement a Canvas loader that dynamically renders a GLB 3D model from the local path '/3d-model/astronaut.glb'. Integrate 'OrbitControls' to allow the user to drag and rotate the model freely, but restrict vertical rotation ranges (min/max polar angles) and disable panning to keep the focus in-bounds. Wrap the canvas inside Drei's '<Stage>' to automatically apply studio lighting, shadow maps, and a clean environment preset."`

---

## 5. Master Architecture Prompt (To generate the entire site)

Provide the prompt below to a highly capable AI Agent to orchestrate the entire project build in one go:

> `"Write a complete Next.js landing page that blends high-fidelity scroll animations with live 3D models. Execute the following files and layouts:
> 
> 1. Set up a global layout with a transparent sticky navigation bar, a high-converting hero overlay, a dual-row marquee logo carousel, a bento grid section, and a professional footer.
> 2. Implement 'ScrollCanvasAnimation.jsx' to load frame images sequentially from '/public/frames/frame_0001.png' through 'frame_0120.png'. Use an HTML5 `<canvas>` with requestAnimationFrame mapping scroll-percentage to frame indexes for lag-free rendering.
> 3. Implement 'ModelViewer.jsx' with React Three Fiber to load and render '/public/3d-model/astronaut.glb' inside a centered interactive WebGL section with auto-shadows, responsive sizing, studio lighting via '<Stage>', and user orbit controls.
> 4. Ensure all styles are fully responsive, performant, and utilize Tailwind CSS. Write code clean of placeholders, properly handling SSR issues by executing Web APIs exclusively in useEffect."`
