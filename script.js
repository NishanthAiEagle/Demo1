/* script.js — Cloud-ready: loads images from external cloud folders (IceDrive)
   Assumes images are publicly accessible at:
     <baseURL>/<i>.png   e.g. https://icedrive.../1.png
   If your cloud returns a page instead of raw image, see notes below.
*/

/* ====== CONFIG: how many images per folder ====== */
/* Update counts if you add/remove images. */
const IMAGE_COUNTS = {
  gold_earrings: 5,
  gold_necklaces: 5,
  diamond_earrings: 5,
  diamond_necklaces: 5
};

/* ====== CONFIG: base URLs for each category (IceDrive share links provided by you) ====== */
/* IMPORTANT: these must point to direct image file path root (CORS allowed).
   Example user-provided links (replace with your actual direct root links if needed):
*/
const IMAGE_BASES = {
  diamond_earrings: "https://icedrive.net/s/k9gY4yjFg7fAubvg52yS4X9jvTuR",     // your provided
  diamond_necklaces: "https://icedrive.net/s/X5GT7xSX8BwzFvR8Qa3g3PZNG79u",
  gold_earrings: "https://icedrive.net/s/BPwy7WN9RSPbYTPDP3avGbQyyWPi",
  gold_necklaces: "https://icedrive.net/s/RRwGfwg5TD75fYXgG628tF85x3Qx"
};

/* OPTIONAL: If your cloud uses a different file pattern, set SUFFIX (default ".png") */
const IMAGE_SUFFIX = ".png";

/* ----- DOM refs (unchanged) ----- */
const videoElement   = document.getElementById('webcam');
const canvasElement  = document.getElementById('overlay');
const canvasCtx      = canvasElement.getContext('2d');

const tryAllBtn      = document.getElementById('tryall-btn');
const flashOverlay   = document.getElementById('flash-overlay');
const galleryModal   = document.getElementById('gallery-modal');
const galleryMain    = document.getElementById('gallery-main');
const galleryThumbs  = document.getElementById('gallery-thumbs');
const galleryClose   = document.getElementById('gallery-close');

let earSizeRange   = document.getElementById('earSizeRange');
let earSizeVal     = document.getElementById('earSizeVal');
let neckYRange     = document.getElementById('neckYRange');
let neckYVal       = document.getElementById('neckYVal');
let neckScaleRange = document.getElementById('neckScaleRange');
let neckScaleVal   = document.getElementById('neckScaleVal');
let posSmoothRange = document.getElementById('posSmoothRange');
let posSmoothVal   = document.getElementById('posSmoothVal');
let earSmoothRange = document.getElementById('earSmoothRange');
let earSmoothVal   = document.getElementById('earSmoothVal');
let debugToggle    = document.getElementById('debugToggle');

/* fallback tuning elements (if not present) */
if (!earSizeRange) {
  earSizeRange = document.createElement('input'); earSizeRange.value = '0.24';
  earSizeVal = { textContent: '0.24' };
  neckYRange = document.createElement('input'); neckYRange.value = '0.65';
  neckYVal = { textContent: '0.65' };
  neckScaleRange = document.createElement('input'); neckScaleRange.value = '.98';
  neckScaleVal = { textContent: '.98' };
  posSmoothRange = document.createElement('input'); posSmoothRange.value = '0.88';
  posSmoothVal = { textContent: '0.88' };
  earSmoothRange = document.createElement('input'); earSmoothRange.value = '0.90';
  earSmoothVal = { textContent: '0.90' };
  debugToggle = document.createElement('div');
}

/* State & assets */
let earringImg = null, necklaceImg = null;
let currentType = '';
let smoothedLandmarks = null;
let lastPersonSegmentation = null;
let bodyPixNet = null;
let lastBodyPixRun = 0;
let lastSnapshotDataURL = '';
let lastFaceMeta = null;

/* Tunables */
let EAR_SIZE_FACTOR = parseFloat(earSizeRange.value || 0.24);
let NECK_Y_OFFSET_FACTOR = parseFloat(neckYRange.value || 0.95);
let NECK_SCALE_MULTIPLIER = parseFloat(neckScaleRange.value || 1.15);
let POS_SMOOTH = parseFloat(posSmoothRange.value || 0.88);
let EAR_DIST_SMOOTH = parseFloat(earSmoothRange.value || 0.90);

const smoothedState = { leftEar: null, rightEar: null, neckPoint: null, angle: 0, earDist: null, faceShape: 'unknown' };
const angleBuffer = [];
const ANGLE_BUFFER_LEN = 5;

let bodyPixNetLoaded = false;

/* watermark (unchanged) */
const watermarkImg = new Image();
watermarkImg.src = "logo_watermark.png";
watermarkImg.crossOrigin = "anonymous";

/* helpers */
function loadImage(src) {
  return new Promise(res => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.src = src;
    i.onload = () => res(i);
    i.onerror = () => {
      console.warn('image load failed:', src);
      res(null);
    };
  });
}
function toPxX(normX) { return normX * canvasElement.width; }
function toPxY(normY) { return normY * canvasElement.height; }
function lerp(a,b,t) { return a*t + b*(1-t); }
function lerpPt(a,b,t) { return { x: lerp(a.x,b.x,t), y: lerp(a.y,b.y,t) }; }

/* BodyPix loader (unchanged) */
async function ensureBodyPixLoaded() {
  if (bodyPixNetLoaded) return;
  try {
    bodyPixNet = await bodyPix.load({ architecture:'MobileNetV1', outputStride:16, multiplier:0.5, quantBytes:2 });
    bodyPixNetLoaded = true;
  } catch(e) {
    console.warn('BodyPix load failed', e);
    bodyPixNetLoaded = false;
  }
}
async function runBodyPixIfNeeded(){
  const throttle = 300; // ms
  const now = performance.now();
  if (!bodyPixNetLoaded) return;
  if (now - lastBodyPixRun < throttle) return;
  lastBodyPixRun = now;
  try {
    const seg = await bodyPixNet.segmentPerson(videoElement, { internalResolution:'low', segmentationThreshold:0.7 });
    lastPersonSegmentation = { data: seg.data, width: seg.width, height: seg.height };
  } catch(e) { console.warn('BodyPix segmentation error', e); }
}

/* FaceMesh setup (unchanged) */
const faceMesh = new FaceMesh({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}` });
faceMesh.setOptions({ maxNumFaces:1, refineLandmarks:true, minDetectionConfidence:0.6, minTrackingConfidence:0.6 });
faceMesh.onResults(onFaceMeshResults);

/* camera init (unchanged) */
async function initCameraAndModels() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: 1280, height: 720 }, audio: false
    });
    videoElement.srcObject = stream;
    videoElement.muted = true;
    videoElement.playsInline = true;
    await videoElement.play();
    const cameraHelper = new Camera(videoElement, {
      onFrame: async () => { await faceMesh.send({ image: videoElement }); },
      width: 1280, height: 720
    });
    cameraHelper.start();
    ensureBodyPixLoaded();
    console.log('✅ Camera started');
  } catch (err) {
    console.error('Camera init error:', err);
    if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
      alert('Please allow camera access for this site (click the camera icon in your browser URL bar).');
    } else if (err.name === 'NotFoundError') {
      alert('No camera found. Please connect a camera and try again.');
    } else {
      alert('Camera initialization failed: ' + (err && err.message ? err.message : err));
    }
  }
}
initCameraAndModels();

/* FaceMesh results handler (unchanged but stores lastFaceMeta) */
async function onFaceMeshResults(results) {
  if (videoElement.videoWidth && videoElement.videoHeight) {
    canvasElement.width = videoElement.videoWidth;
    canvasElement.height = videoElement.videoHeight;
  }
  canvasCtx.clearRect(0,0,canvasElement.width,canvasElement.height);
  try { canvasCtx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height); } catch(e) {}
  if (!results.multiFaceLandmarks || !results.multiFaceLandmarks.length) {
    smoothedLandmarks = null;
    lastFaceMeta = null;
    drawWatermark(canvasCtx);
    return;
  }
  const landmarks = results.multiFaceLandmarks[0];
  if (!smoothedLandmarks) smoothedLandmarks = landmarks;
  else {
    smoothedLandmarks = smoothedLandmarks.map((prev,i) => ({
      x: prev.x * 0.72 + landmarks[i].x * 0.28,
      y: prev.y * 0.72 + landmarks[i].y * 0.28,
      z: prev.z * 0.72 + landmarks[i].z * 0.28
    }));
  }
  const leftEar  = { x: toPxX(smoothedLandmarks[132].x), y: toPxY(smoothedLandmarks[132].y) };
  const rightEar = { x: toPxX(smoothedLandmarks[361].x), y: toPxY(smoothedLandmarks[361].y) };
  const neckP    = { x: toPxX(smoothedLandmarks[152].x), y: toPxY(smoothedLandmarks[152].y) };

  let minX=1,minY=1,maxX=0,maxY=0;
  for (let i=0;i<smoothedLandmarks.length;i++){
    const lm = smoothedLandmarks[i];
    if (lm.x < minX) minX = lm.x;
    if (lm.y < minY) minY = lm.y;
    if (lm.x > maxX) maxX = lm.x;
    if (lm.y > maxY) maxY = lm.y;
  }
  const faceWidth = (maxX - minX) * canvasElement.width;
  const faceHeight = (maxY - minY) * canvasElement.height;
  const aspect = faceHeight / (faceWidth || 1);

  let faceShape = 'oval';
  if (aspect < 1.05) faceShape = 'round';
  else if (aspect > 1.25) faceShape = 'long';
  smoothedState.faceShape = faceShape;

  // store meta
  lastFaceMeta = { faceWidth, faceHeight, faceShape };

  const rawEarDist = Math.hypot(rightEar.x - leftEar.x, rightEar.y - leftEar.y);
  if (smoothedState.earDist == null) smoothedState.earDist = rawEarDist;
  else smoothedState.earDist = smoothedState.earDist * EAR_DIST_SMOOTH + rawEarDist * (1 - EAR_DIST_SMOOTH);

  if (!smoothedState.leftEar) {
    smoothedState.leftEar = leftEar; smoothedState.rightEar = rightEar; smoothedState.neckPoint = neckP;
    smoothedState.angle = Math.atan2(rightEar.y - leftEar.y, rightEar.x - leftEar.x);
  } else {
    smoothedState.leftEar = lerpPt(smoothedState.leftEar, leftEar, POS_SMOOTH);
    smoothedState.rightEar = lerpPt(smoothedState.rightEar, rightEar, POS_SMOOTH);
    smoothedState.neckPoint = lerpPt(smoothedState.neckPoint, neckP, POS_SMOOTH);

    const rawAngle = Math.atan2(rightEar.y - leftEar.y, rightEar.x - leftEar.x);
    let prev = smoothedState.angle;
    let diff = rawAngle - prev;
    if (diff > Math.PI) diff -= 2*Math.PI;
    if (diff < -Math.PI) diff += 2*Math.PI;
    smoothedState.angle = prev + diff * (1 - 0.82);
  }

  angleBuffer.push(smoothedState.angle);
  if (angleBuffer.length > ANGLE_BUFFER_LEN) angleBuffer.shift();
  if (angleBuffer.length > 2) {
    const s = angleBuffer.slice().sort((a,b)=>a-b);
    smoothedState.angle = s[Math.floor(s.length/2)];
  }

  drawJewelrySmart(smoothedState, canvasCtx, smoothedLandmarks, lastFaceMeta);

  await ensureBodyPixLoaded();
  runBodyPixIfNeeded();
  if (lastPersonSegmentation && lastPersonSegmentation.data) {
    compositeHeadOcclusion(canvasCtx, smoothedLandmarks, lastPersonSegmentation);
  } else {
    drawWatermark(canvasCtx);
  }

  if (debugToggle.classList && debugToggle.classList.contains('on')) drawDebugMarkers();
}

/* drawJewelrySmart unchanged (keeps your offsets & logic) */
function drawJewelrySmart(state, ctx, landmarks, meta) {
  if (!meta) return;
  const leftEar = state.leftEar, rightEar = state.rightEar, neckPoint = state.neckPoint;
  const earDist = state.earDist || Math.hypot(rightEar.x - leftEar.x, rightEar.y - leftEar.y);
  const angle = state.angle || 0;
  const faceShape = meta.faceShape;
  const faceW = meta.faceWidth, faceH = meta.faceHeight;

  let xAdjPx = 0, yAdjPx = 0, sizeMult = 1.0;
  if (faceShape === 'round') {
    xAdjPx = Math.round(faceW * 0.06);
    yAdjPx = Math.round(faceH * 0.02);
    sizeMult = 1.10;
  } else if (faceShape === 'oval') {
    xAdjPx = Math.round(faceW * 0.045);
    yAdjPx = Math.round(faceH * 0.015);
    sizeMult = 1.00;
  } else {
    xAdjPx = Math.round(faceW * 0.04);
    yAdjPx = Math.round(faceH * 0.005);
    sizeMult = 0.95;
  }

  const finalEarringFactor = EAR_SIZE_FACTOR * sizeMult;

  if (earringImg && landmarks) {
    const eWidth = earDist * finalEarringFactor;
    const eHeight = (earringImg.height / earringImg.width) * eWidth;
    const leftCenterX = leftEar.x - xAdjPx;
    const rightCenterX = rightEar.x + xAdjPx;
    const leftCenterY = leftEar.y + (eHeight * 0.18) + yAdjPx;
    const rightCenterY = rightEar.y + (eHeight * 0.18) + yAdjPx;
    const tiltCorrection = - (angle * 0.08);

    ctx.save();
    ctx.translate(leftCenterX, leftCenterY);
    ctx.rotate(tiltCorrection);
    ctx.drawImage(earringImg, -eWidth/2, -eHeight/2, eWidth, eHeight);
    ctx.restore();

    ctx.save();
    ctx.translate(rightCenterX, rightCenterY);
    ctx.rotate(-tiltCorrection);
    ctx.drawImage(earringImg, -eWidth/2, -eHeight/2, eWidth, eHeight);
    ctx.restore();
  }

  if (necklaceImg && landmarks) {
    const nw = earDist * NECK_SCALE_MULTIPLIER;
    const nh = (necklaceImg.height / necklaceImg.width) * nw;
    const yOffset = earDist * NECK_Y_OFFSET_FACTOR;
    ctx.save();
    ctx.translate(neckPoint.x, neckPoint.y + yOffset);
    ctx.rotate(angle);
    ctx.drawImage(necklaceImg, -nw/2, -nh/2, nw, nh);
    ctx.restore();
  }

  drawWatermark(ctx);
}

/* drawWatermark & compositeHeadOcclusion unchanged (omitted here for brevity) */
/* ... (use your existing functions for watermark and occlusion from previous file) ... */

/* Snapshot / Try-all / Gallery code (unchanged except image sources) */
/* The key change is how we build image src strings below */

/* Asset UI: categories & thumbnails — (NEW) uses IMAGE_BASES */
function toggleCategory(category){
  const subPanel = document.getElementById('subcategory-buttons');
  if (subPanel) subPanel.style.display = 'flex';

  const subs = document.querySelectorAll('#subcategory-buttons button');
  subs.forEach(b => {
    const label = b.innerText.toLowerCase();
    b.style.display = label.includes(category) ? 'inline-block' : 'none';
  });

  const jopt = document.getElementById('jewelry-options'); 
  if (jopt) jopt.style.display = 'none';

  stopAutoTry();
}

/* helper: return the base url (with trailing slash) for a type */
function getBaseForType(type){
  let base = IMAGE_BASES[type] || "";
  // ensure trailing slash for concatenation
  if (base && !base.endsWith("/")) base = base + "/";
  return base;
}

/* When subcategory is selected — inserts thumbnails using remote base URLs */
function selectJewelryType(type){
  currentType = type;
  const container = document.getElementById('jewelry-options');
  if (!container) return;
  container.innerHTML = '';
  container.style.display = 'flex';
  earringImg = null; necklaceImg = null;
  stopAutoTry();

  const base = getBaseForType(type);
  const count = IMAGE_COUNTS[type] || 0;

  // If base is blank -> show warning thumbnail
  if (!base) {
    const warn = document.createElement('div');
    warn.style.padding = '12px'; warn.style.color = '#ffd';
    warn.textContent = 'No base URL configured for ' + type;
    container.appendChild(warn);
    return;
  }

  for (let i = 1; i <= count; i++){
    // build remote URL (assumes direct file access)
    const src = base + i + IMAGE_SUFFIX;
    const btn = document.createElement('button');
    const img = document.createElement('img');
    img.src = src;
    img.onerror = () => { img.style.opacity = 0.4; img.title = "Failed to load"; };
    btn.appendChild(img);

    btn.onclick = () => {
      if (type.includes('earrings')) changeEarring(src);
      else changeNecklace(src);
    };
    container.appendChild(btn);
  }
}

/* Used by Try-All; builds remote list */
function buildImageList(type){
  const base = getBaseForType(type);
  const count = IMAGE_COUNTS[type] || 0;
  const list = [];
  if (!base) return list;
  for (let i = 1; i <= count; i++){
    list.push(base + i + IMAGE_SUFFIX);
  }
  return list;
}

/* load earring / necklace images */
async function changeEarring(src){ earringImg = await loadImage(src); }
async function changeNecklace(src){ necklaceImg = await loadImage(src); }

/* rest of code (snapshots, try-all, gallery, modal toggles) remains the same */
/* copy the remaining functions from your previous script (flash, takeSnapshot, openGallery, etc.)
   — they are unchanged, only image sources are now remote. */

