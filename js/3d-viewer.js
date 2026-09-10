/**
 * MPPT Journal - Interactive 3D Pharmaceutical Molecular Viewer
 * Built with Three.js (WebGL)
 * Allows users to inspect and rotate a bioactive pharmacophore lattice with ambient glowing particles.
 */

(function () {
  const container = document.getElementById('three-container');
  if (!container) return;

  // Scene, Camera, Renderer
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / container.clientHeight,
    0.1,
    1000
  );
  camera.position.z = 24;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  // Group for rotating molecule
  const moleculeGroup = new THREE.Group();
  scene.add(moleculeGroup);

  // Colors
  const COLOR_CARBON = 0x1f3d32;
  const COLOR_OXYGEN = 0xc5a059;
  const COLOR_NITROGEN = 0x38bdf8;
  const COLOR_HYDROGEN = 0xe2e8f0;
  const COLOR_GOLD = 0xdfb76c;

  // Node data for interactive raycasting
  const nodes = [
    { x: 0, y: 0, z: 0, r: 1.2, color: COLOR_GOLD, label: "Core Heterocycle", desc: "Pharmacophoric scaffold driving high-affinity receptor docking." },
    { x: 2.8, y: 1.6, z: 0.5, r: 0.9, color: COLOR_NITROGEN, label: "Tertiary Amine Base", desc: "Key hydrogen bond acceptor site optimizing bioavailability." },
    { x: -2.8, y: 1.4, z: -0.6, r: 0.9, color: COLOR_OXYGEN, label: "Carbonyl Bioisostere", desc: "Modulates metabolic clearance and blood-brain barrier permeability." },
    { x: 1.8, y: -2.6, z: 0.8, r: 0.85, color: COLOR_CARBON, label: "Lipophilic Phenyl Ring", desc: "Provides hydrophobic pi-stacking interactions with target kinase." },
    { x: -2.0, y: -2.4, z: -0.7, r: 0.85, color: COLOR_CARBON, label: "Fluoroalkyl Chain", desc: "Enhances lipophilicity logP and half-life kinetics." },
    { x: 4.6, y: 0.4, z: 1.2, r: 0.6, color: COLOR_HYDROGEN, label: "Target Contact Residue", desc: "Direct van der Waals stabilization within enzyme binding pocket." },
    { x: -4.4, y: 0.2, z: -1.0, r: 0.6, color: COLOR_HYDROGEN, label: "Solvation Envelope", desc: "Aqueous solubility buffer minimizing renal toxicity." },
  ];

  const atomMeshes = [];

  // Create Atoms (Spheres)
  const sphereGeo = new THREE.SphereGeometry(1, 32, 32);
  nodes.forEach((data, index) => {
    const mat = new THREE.MeshPhysicalMaterial({
      color: data.color,
      roughness: 0.2,
      metalness: 0.6,
      clearcoat: 0.8,
      clearcoatRoughness: 0.1,
      emissive: data.color,
      emissiveIntensity: 0.15
    });

    const mesh = new THREE.Mesh(sphereGeo, mat);
    mesh.scale.setScalar(data.r);
    mesh.position.set(data.x, data.y, data.z);
    mesh.userData = data;
    moleculeGroup.add(mesh);
    atomMeshes.push(mesh);
  });

  // Bonds (Cylinders)
  const bondConnections = [
    [0, 1], [0, 2], [0, 3], [0, 4],
    [1, 5], [2, 6], [3, 4]
  ];

  const bondMat = new THREE.MeshPhysicalMaterial({
    color: 0x64748b,
    metalness: 0.8,
    roughness: 0.3,
    transparent: true,
    opacity: 0.85
  });

  bondConnections.forEach(([i, j]) => {
    const p1 = new THREE.Vector3(nodes[i].x, nodes[i].y, nodes[i].z);
    const p2 = new THREE.Vector3(nodes[j].x, nodes[j].y, nodes[j].z);
    const distance = p1.distanceTo(p2);
    const cylinderGeo = new THREE.CylinderGeometry(0.18, 0.18, distance, 16);
    const cylinder = new THREE.Mesh(cylinderGeo, bondMat);

    // Position & Orientation
    cylinder.position.copy(p1).lerp(p2, 0.5);
    cylinder.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      p2.clone().sub(p1).normalize()
    );
    moleculeGroup.add(cylinder);
  });

  // Orbital Ring Accent
  const ringGeo = new THREE.TorusGeometry(6.2, 0.04, 16, 100);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xc5a059, transparent: true, opacity: 0.35 });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 3;
  moleculeGroup.add(ring);

  const ringGeo2 = new THREE.TorusGeometry(8.5, 0.03, 16, 100);
  const ringMat2 = new THREE.MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.25 });
  const ring2 = new THREE.Mesh(ringGeo2, ringMat2);
  ring2.rotation.y = Math.PI / 4;
  ring2.rotation.z = Math.PI / 6;
  moleculeGroup.add(ring2);

  // Background Ambient Dust Particles
  const particleCount = 200;
  const particleGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount * 3; i += 3) {
    positions[i] = (Math.random() - 0.5) * 50;
    positions[i + 1] = (Math.random() - 0.5) * 50;
    positions[i + 2] = (Math.random() - 0.5) * 50;
  }
  particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const particleMat = new THREE.PointsMaterial({
    color: 0xc5a059,
    size: 0.15,
    transparent: true,
    opacity: 0.4
  });
  const particles = new THREE.Points(particleGeo, particleMat);
  scene.add(particles);

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
  scene.add(ambientLight);

  const pointLight1 = new THREE.PointLight(0xdfb76c, 2.5, 100);
  pointLight1.position.set(12, 15, 15);
  scene.add(pointLight1);

  const pointLight2 = new THREE.PointLight(0x10b981, 2.0, 100);
  pointLight2.position.set(-12, -10, -10);
  scene.add(pointLight2);

  // Interactive Mouse Drag & Hover Controls
  let isDragging = false;
  let prevMousePos = { x: 0, y: 0 };
  let targetRotation = { x: 0.2, y: 0.4 };
  let autoRotate = true;

  container.addEventListener('mousedown', (e) => {
    isDragging = true;
    prevMousePos = { x: e.clientX, y: e.clientY };
    autoRotate = false;
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
    setTimeout(() => { autoRotate = true; }, 3000);
  });

  window.addEventListener('mousemove', (e) => {
    if (isDragging) {
      const deltaX = e.clientX - prevMousePos.x;
      const deltaY = e.clientY - prevMousePos.y;
      targetRotation.y += deltaX * 0.008;
      targetRotation.x += deltaY * 0.008;
      prevMousePos = { x: e.clientX, y: e.clientY };
    }

    // Raycast for atom hover
    const rect = container.getBoundingClientRect();
    if (
      e.clientX >= rect.left && e.clientX <= rect.right &&
      e.clientY >= rect.top && e.clientY <= rect.bottom
    ) {
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / container.clientWidth) * 2 - 1,
        -((e.clientY - rect.top) / container.clientHeight) * 2 + 1
      );
      raycastAtoms(mouse);
    }
  });

  // Touch Support
  container.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      isDragging = true;
      prevMousePos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      autoRotate = false;
    }
  }, { passive: true });

  container.addEventListener('touchmove', (e) => {
    if (isDragging && e.touches.length === 1) {
      const deltaX = e.touches[0].clientX - prevMousePos.x;
      const deltaY = e.touches[0].clientY - prevMousePos.y;
      targetRotation.y += deltaX * 0.01;
      targetRotation.x += deltaY * 0.01;
      prevMousePos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  }, { passive: true });

  window.addEventListener('touchend', () => {
    isDragging = false;
    setTimeout(() => { autoRotate = true; }, 3000);
  });

  // Raycaster for Hover Details
  const raycaster = new THREE.Raycaster();
  const tooltip = document.getElementById('molecule-tooltip');
  const tooltipTitle = document.getElementById('mol-tooltip-title');
  const tooltipDesc = document.getElementById('mol-tooltip-desc');

  function raycastAtoms(mouse) {
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(atomMeshes);

    if (intersects.length > 0) {
      const hit = intersects[0].object;
      const data = hit.userData;
      if (tooltip && tooltipTitle && tooltipDesc) {
        tooltipTitle.textContent = data.label;
        tooltipDesc.textContent = data.desc;
        tooltip.style.opacity = '1';
        tooltip.style.transform = 'translateY(0)';
      }
    }
  }

  // Animation Loop
  function animate() {
    requestAnimationFrame(animate);

    if (autoRotate) {
      targetRotation.y += 0.003;
      targetRotation.x = Math.sin(Date.now() * 0.0008) * 0.15;
    }

    // Smooth lerp rotation
    moleculeGroup.rotation.y += (targetRotation.y - moleculeGroup.rotation.y) * 0.08;
    moleculeGroup.rotation.x += (targetRotation.x - moleculeGroup.rotation.x) * 0.08;

    // Pulse rings
    ring.rotation.z += 0.002;
    ring2.rotation.x += 0.0015;

    // Subtle drift of particles
    particles.rotation.y += 0.0004;

    renderer.render(scene, camera);
  }

  animate();

  // Resize Listener
  window.addEventListener('resize', () => {
    if (!container) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });
})();
