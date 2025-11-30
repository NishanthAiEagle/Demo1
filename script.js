// =============== BASIC SETUP ===============
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('overlay');
const canvasCtx = canvasElement.getContext('2d');

const subcategoryButtons = document.getElementById('subcategory-buttons');
const jewelryOptions = document.getElementById('jewelry-options');

let earringImg = null;
let necklaceImg = null;

let currentCategory = '';   // "earrings" | "necklaces"
let currentTypeKey = '';    // "gold_earrings", "diamond_necklaces"

let smoothedFaceLandmarks = null;
let smoothedFacePoints = {};
let camera = null;

// Snapshot (single) elements
const captureBtn = document.getElementById('capture-btn');
const snapshotModal = document.getElementById('snapshot-modal');
const snapshotPreview = document.getElementById('snapshot-preview');
const closeSnapshotBtn = document.getElementById('close-snapshot');
const downloadBtn = document.getElementById('download-btn');
const shareBtn = document.getElementById('share-btn');
let lastSnapshotDataURL = '';

// TRY ALL button + gallery elements
const autoTryBtn = document.getElementById('auto-try-btn');
let autoTryRunning = false;
let autoTryTimeout = null;
let autoTryIndex = 0;
let autoSnapshots = [];

const galleryModal = document.getElementById('gallery-modal');
const closeGalleryBtn = document.getElementById('close-gallery');
const galleryMainPreview = document.getElementById('gallery-main-preview');
const galleryThumbs = document.getElementById('gallery-thumbs');

// NEW: Gentle zoom based on face size
let currentZoom = 1;

// ==========================================
// 1. LOCAL FILES CONFIG
// ==========================================

const LOCAL_IMAGES = {
  diamond_earrings: ['001.png','002.png','003.png','004.png','005.png'],
  diamond_necklaces: ['1.png','01.png','2.png','02.png','3.png','03.png','05.png'],
  gold_earrings: ['s3.png','s4.png','s5.png','s006.png','s007.png'],
  gold_necklaces: ['001.png']
};

function buildSrc(typeKey, filename) {
  return `${typeKey}/${filename}`;
}

// ==========================================
// 2. LOAD JEWELRY FROM LOCAL FOLDERS
// ==========================================

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      console.warn('Image failed:', src);
      resolve(null);
    };
    img.src = src;
  });
}

async function changeJewelry(typeKey, src) {
  const img = await loadImage(src);
  if (!img) return;
  earringImg = necklaceImg = null;
  if (typeKey.includes('earrings')) earringImg = img;
  else necklaceImg = img;
}

// ==========================================
// 3. CATEGORY HANDLING
// ==========================================

function toggleCategory(category) {
  stopAutoTry();
  currentCategory = category;
  jewelryOptions.style.display = "none";
  subcategoryButtons.style.display = "flex";
}

function selectJewelryType(category, metal) {
  stopAutoTry();
  const typeKey = `${metal}_${category}`;  // eg: "gold_earrings"
  currentTypeKey = typeKey;

  subcategoryButtons.style.display = "none";
  jewelryOptions.style.display = "flex";

  insertJewelryOptions(typeKey);
}

window.toggleCategory = toggleCategory;
window.selectJewelryType = selectJewelryType;

function insertJewelryOptions(typeKey) {
  jewelryOptions.innerHTML = "";
  const files = LOCAL_IMAGES[typeKey] || [];

  files.forEach((filename) => {
    const src = buildSrc(typeKey, filename);
    const btn = document.createElement("button");
    const img = document.createElement("img");
    img.src = src;

    img.onload = () => {
      btn.onclick = () => changeJewelry(typeKey, src);
      btn.appendChild(img);
      jewelryOptions.appendChild(btn);
    };
  });
}

// ==========================================
// 4. MEDIAPIPE FACE MESH
// ==========================================

const faceMesh = new FaceMesh({
  locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`
});

faceMesh.setOptions({
  maxNumFaces: 1,
  refineLandmarks: true,
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.6
});

faceMesh.onResults(results => {
  canvasCtx.clearRect(0,0,canvasElement.width,canvasElement.height);

  if (results.multiFaceLandmarks?.length) {
    const newLandmarks = results.multiFaceLandmarks[0];

    if (!smoothedFaceLandmarks) smoothedFaceLandmarks = newLandmarks;
    else {
      smoothedFaceLandmarks = smoothedFaceLandmarks.map((p, i) => ({
        x: p.x * 0.8 + newLandmarks[i].x * 0.2,
        y: p.y * 0.8 + newLandmarks[i].y * 0.2,
        z: p.z * 0.8 + newLandmarks[i].z * 0.2
      }));
    }

    // NEW: update gentle zoom based on face size
    updateZoom(smoothedFaceLandmarks);

    drawJewelry(smoothedFaceLandmarks);
  }
});

// Start Camera
document.addEventListener("DOMContentLoaded", () => startCamera());

function startCamera(facingMode="user") {
  if (camera) camera.stop();
  camera = new Camera(videoElement, {
    onFrame: async () => await faceMesh.send({ image: videoElement }),
    width: 1280,
    height: 720,
    facingMode
  });
  camera.start();
}

videoElement.onloadedmetadata = () => {
  canvasElement.width = videoElement.videoWidth;
  canvasElement.height = videoElement.videoHeight;
};

// ==========================================
// 5. GENTLE AUTO ZOOM
// ==========================================

function updateZoom(face) {
  if (!face || !canvasElement.width) return;

  const vw = canvasElement.width;
  const vh = canvasElement.height;

  const L = face[33];
  const R = face[263];

  const dx = (R.x - L.x) * vw;
  const dy = (R.y - L.y) * vh;
  const eyeDist = Math.hypot(dx, dy);

  // We want eyes to occupy around ~28% of width
  const targetFraction = 0.28;
  const targetEyeDist = vw * targetFraction;

  let z = targetEyeDist / eyeDist;

  // Clamp for gentle zoom only
  if (z < 1.0) z = 1.0;
  if (z > 1.25) z = 1.25;

  // Smooth the zoom change
  currentZoom = currentZoom * 0.85 + z * 0.15;

  const transformStr = `scale(${currentZoom})`;
  videoElement.style.transform = transformStr;
  canvasElement.style.transform = transformStr;
}

// ==========================================
// 6. DRAW JEWELRY
// ==========================================

function drawJewelry(face) {
  if (!face) return;

  const vw = canvasElement.width;
  const vh = canvasElement.height;

  const L = face[33];
  const R = face[263];
  const eyeDist = Math.hypot((R.x-L.x)*vw, (R.y-L.y)*vh);

  // Earrings
  const le = face[132];
  const re = face[361];

  const leftPos = { x: le.x*vw, y: le.y*vh };
  const rightPos = { x: re.x*vw, y: re.y*vh };

  smoothedFacePoints.left = smoothPoint(smoothedFacePoints.left, leftPos);
  smoothedFacePoints.right = smoothPoint(smoothedFacePoints.right, rightPos);

  if (earringImg) {
    const w = eyeDist * 0.42;
    const h = w * (earringImg.height / earringImg.width);

    canvasCtx.drawImage(earringImg, smoothedFacePoints.left.x-w/2, smoothedFacePoints.left.y, w, h);
    canvasCtx.drawImage(earringImg, smoothedFacePoints.right.x-w/2, smoothedFacePoints.right.y, w, h);
  }

  // Necklace
  const neck = face[152];
  const neckPos = { x: neck.x*vw, y: neck.y*vh };
  smoothedFacePoints.neck = smoothPoint(smoothedFacePoints.neck, neckPos);

  if (necklaceImg) {
    const w = eyeDist * 1.6;
    const h = w * (necklaceImg.height / necklaceImg.width);
    const offset = eyeDist * 1.0;

    canvasCtx.drawImage(necklaceImg, smoothedFacePoints.neck.x-w/2, smoothedFacePoints.neck.y+offset, w, h);
  }
}

function smoothPoint(prev, curr, factor=0.4) {
  if (!prev) return curr;
  return {
    x: prev.x*(1-factor) + curr.x*factor,
    y: prev.y*(1-factor) + curr.y*factor
  };
}

// ==========================================
// 7. CAPTURE CURRENT FRAME (NO POPUP)
// ==========================================

function captureCurrentFrameDataURL() {
  const snapCanvas = document.createElement("canvas");
  snapCanvas.width = canvasElement.width;
  snapCanvas.height = canvasElement.height;
  const ctx = snapCanvas.getContext("2d");

  ctx.drawImage(videoElement,0,0,snapCanvas.width,snapCanvas.height);
  if (smoothedFaceLandmarks) drawJewelry(smoothedFaceLandmarks, ctx);

  return snapCanvas.toDataURL("image/png");
}

// ==========================================
// 8. MANUAL SNAPSHOT (CAMERA BUTTON)
// ==========================================

function takeSnapshot() {
  lastSnapshotDataURL = captureCurrentFrameDataURL();
  snapshotPreview.src = lastSnapshotDataURL;
  snapshotModal.style.display = "flex";
}

function closeSnapshot() {
  snapshotModal.style.display = "none";
}

function downloadSnapshot() {
  const a = document.createElement("a");
  a.href = lastSnapshotDataURL;
  a.download = "tryon.png";
  a.click();
}

async function shareSnapshot() {
  if (!navigator.share || !navigator.canShare) {
    alert("Sharing not supported");
    return;
  }
  const blob = await (await fetch(lastSnapshotDataURL)).blob();
  const file = new File([blob], "tryon.png", { type: "image/png" });

  await navigator.share({ files: [file], title: "Jewels Try-On" });
}

captureBtn.onclick = takeSnapshot;
closeSnapshotBtn.onclick = closeSnapshot;
downloadBtn.onclick = downloadSnapshot;
shareBtn.onclick = shareSnapshot;

// ==========================================
// 9. TRY ALL + AUTO SCREENSHOT + GALLERY
// ==========================================

function stopAutoTry() {
  autoTryRunning = false;
  if (autoTryTimeout) clearTimeout(autoTryTimeout);
  autoTryTimeout = null;
  autoTryBtn.classList.remove('active');
  autoTryBtn.textContent = 'TRY ALL';
}

async function runAutoTryAll() {
  if (!currentTypeKey) {
    alert("Please choose Earrings/Chains and then Gold/Diamond first.");
    stopAutoTry();
    return;
  }

  const files = LOCAL_IMAGES[currentTypeKey] || [];
  if (!files.length) {
    alert("No jewelry images found for this type.");
    stopAutoTry();
    return;
  }

  autoSnapshots = [];
  autoTryIndex = 0;
  autoTryRunning = true;
  autoTryBtn.classList.add('active');
  autoTryBtn.textContent = 'STOP';

  const loopStep = async () => {
    if (!autoTryRunning) return;

    const filename = files[autoTryIndex];
    const src = buildSrc(currentTypeKey, filename);

    await changeJewelry(currentTypeKey, src);

    // wait so jewelry + face stabilize
    await new Promise(res => setTimeout(res, 1200));

    const dataURL = captureCurrentFrameDataURL();
    autoSnapshots.push(dataURL);

    autoTryIndex++;
    if (autoTryIndex >= files.length) {
      stopAutoTry();
      openGallery();
      return;
    }

    autoTryTimeout = setTimeout(loopStep, 200);
  };

  loopStep();
}

function toggleAutoTry() {
  if (autoTryRunning) stopAutoTry();
  else runAutoTryAll();
}

autoTryBtn.onclick = toggleAutoTry;

// GALLERY

function openGallery() {
  if (!autoSnapshots.length) {
    alert("No screenshots captured.");
    return;
  }

  galleryThumbs.innerHTML = '';

  autoSnapshots.forEach((src, idx) => {
    const img = document.createElement('img');
    img.src = src;
    img.onclick = () => setGalleryMain(idx);
    galleryThumbs.appendChild(img);
  });

  setGalleryMain(0);
  galleryModal.style.display = 'flex';
}

function setGalleryMain(index) {
  const src = autoSnapshots[index];
  galleryMainPreview.src = src;

  const thumbs = galleryThumbs.querySelectorAll('img');
  thumbs.forEach((t, i) => {
    t.classList.toggle('active', i === index);
  });
}

function closeGallery() {
  galleryModal.style.display = 'none';
}

closeGalleryBtn.onclick = closeGallery;
