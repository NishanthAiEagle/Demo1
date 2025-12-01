const videoElement   = document.getElementById('webcam');
const canvasElement  = document.getElementById('overlay');
const canvasCtx      = canvasElement.getContext('2d');

let earringImg = null;
let necklaceImg = null;
let earringSrc = '';
let necklaceSrc = '';
let currentType = '';
let smoothedLandmarks = null;
let lastSnapshotDataURL = '';

/* TRY ALL + Gallery */
let autoTryRunning = false;
let autoTryTimeout = null;
let autoTryIndex = 0;
let autoSnapshots = [];

const tryAllBtn      = document.getElementById('tryall-btn');
const flashOverlay   = document.getElementById('flash-overlay');
const galleryModal   = document.getElementById('gallery-modal');
const galleryMain    = document.getElementById('gallery-main');
const galleryThumbs  = document.getElementById('gallery-thumbs');
const galleryClose   = document.getElementById('gallery-close');

/* ------------ image helpers ------------ */
function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = src;
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
  });
}

async function changeEarring(src) {
  earringSrc = src;
  const img = await loadImage(earringSrc);
  if (img) earringImg = img;
}

async function changeNecklace(src) {
  necklaceSrc = src;
  const img = await loadImage(necklaceSrc);
  if (img) necklaceImg = img;
}

/* ------------ category / subcategory ------------ */
function toggleCategory(category) {
  document.getElementById('subcategory-buttons').style.display = 'flex';
  const subButtons = document.querySelectorAll('#subcategory-buttons button');
  subButtons.forEach(btn => {
    btn.style.display =
      btn.innerText.toLowerCase().includes(category) ? 'inline-block' : 'none';
  });
  document.getElementById('jewelry-options').style.display = 'none';
  stopAutoTry();
}

function selectJewelryType(type) {
  currentType = type;
  document.getElementById('jewelry-options').style.display = 'flex';

  earringImg = null;
  necklaceImg = null;
  earringSrc = '';
  necklaceSrc = '';

  const { start, end } = getRangeForType(type);
  insertJewelryOptions(type, 'jewelry-options', start, end);

  stopAutoTry();
}

function getRangeForType(type) {
  let start = 1, end = 15;
  switch (type) {
    case 'gold_earrings':     end = 16; break;
    case 'gold_necklaces':    end = 19; break;
    case 'diamond_earrings':  end = 9;  break;
    case 'diamond_necklaces': end = 6;  break;
    default:                  end = 15;
  }
  return { start, end };
}

function buildImageList(type) {
  const { start, end } = getRangeForType(type);
  const list = [];
  for (let i = start; i <= end; i++) {
    list.push(`${type}/${type}${i}.png`);
  }
  return list;
}

function insertJewelryOptions(type, containerId, startIndex, endIndex) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  for (let i = startIndex; i <= endIndex; i++) {
    const filename = `${type}${i}.png`;
    const src = `${type}/${filename}`;
    const btn = document.createElement('button');
    const img = document.createElement('img');
    img.src = src;
    btn.appendChild(img);
    btn.onclick = () => {
      if (type.includes('earrings')) {
        changeEarring(src);
      } else {
        changeNecklace(src);
      }
    };
    container.appendChild(btn);
  }
}

/* ------------ Mediapipe FaceMesh ------------ */
const faceMesh = new FaceMesh({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
});

faceMesh.setOptions({
  maxNumFaces: 1,
  refineLandmarks: true,
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.6
});

faceMesh.onResults((results) => {
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

  if (!results.multiFaceLandmarks || !results.multiFaceLandmarks.length) {
    smoothedLandmarks = null;
    return;
  }

  const landmarks = results.multiFaceLandmarks[0];

  if (!smoothedLandmarks) {
    smoothedLandmarks = landmarks;
  } else {
    smoothedLandmarks = smoothedLandmarks.map((prev, i) => ({
      x: prev.x * 0.7 + landmarks[i].x * 0.3,
      y: prev.y * 0.7 + landmarks[i].y * 0.3,
      z: prev.z * 0.7 + landmarks[i].z * 0.3,
    }));
  }

  drawJewelry(smoothedLandmarks, canvasCtx);
});

/* ------------ Camera ------------ */
const camera = new Camera(videoElement, {
  onFrame: async () => {
    await faceMesh.send({ image: videoElement });
  },
  width: 1280,
  height: 720
});

videoElement.addEventListener('loadedmetadata', () => {
  canvasElement.width = videoElement.videoWidth;
  canvasElement.height = videoElement.videoHeight;
});

camera.start();

/* ------------ draw jewelry ------------ */
function drawJewelry(landmarks, ctx) {
  const context = ctx || canvasCtx;

  const earringScale = 0.07;
  const necklaceScale = 0.18;

  const leftEar = {
    x: landmarks[132].x * canvasElement.width - 6,
    y: landmarks[132].y * canvasElement.height - 16,
  };
  const rightEar = {
    x: landmarks[361].x * canvasElement.width + 6,
    y: landmarks[361].y * canvasElement.height - 16,
  };
  const neck = {
    x: landmarks[152].x * canvasElement.width - 8,
    y: landmarks[152].y * canvasElement.height + 10,
  };

  if (earringImg) {
    const width = earringImg.width * earringScale;
    const height = earringImg.height * earringScale;
    context.drawImage(earringImg, leftEar.x - width / 2, leftEar.y, width, height);
    context.drawImage(earringImg, rightEar.x - width / 2, rightEar.y, width, height);
  }

  if (necklaceImg) {
    const width = necklaceImg.width * necklaceScale;
    const height = necklaceImg.height * necklaceScale;
    context.drawImage(necklaceImg, neck.x - width / 2, neck.y, width, height);
  }
}

/* ------------ snapshot helpers ------------ */
function triggerFlash() {
  if (!flashOverlay) return;
  flashOverlay.classList.add('active');
  setTimeout(() => flashOverlay.classList.remove('active'), 180);
}

function captureSnapshotDataURL() {
  const snapshotCanvas = document.createElement('canvas');
  const ctx = snapshotCanvas.getContext('2d');

  snapshotCanvas.width  = canvasElement.width;
  snapshotCanvas.height = canvasElement.height;

  ctx.drawImage(videoElement, 0, 0, snapshotCanvas.width, snapshotCanvas.height);
  if (smoothedLandmarks) {
    drawJewelry(smoothedLandmarks, ctx);
  }
  return snapshotCanvas.toDataURL('image/png');
}

/* ------------ manual snapshot button (single) ------------ */
function takeSnapshot() {
  if (!smoothedLandmarks) {
    alert("Face not detected. Please try again.");
    return;
  }

  triggerFlash();
  lastSnapshotDataURL = captureSnapshotDataURL();
  document.getElementById('snapshot-preview').src = lastSnapshotDataURL;
  document.getElementById('snapshot-modal').style.display = 'block';
}

function saveSnapshot() {
  const link = document.createElement('a');
  link.href = lastSnapshotDataURL;
  link.download = `jewelry-tryon-${Date.now()}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function shareSnapshot() {
  if (!navigator.share || !navigator.canShare) {
    alert('Sharing not supported on this device.');
    return;
  }
  const resp = await fetch(lastSnapshotDataURL);
  const blob = await resp.blob();
  const file = new File([blob], 'jewelry-tryon.png', { type: 'image/png' });

  await navigator.share({
    title: 'Jewelry Try-On',
    text: 'Check out my look!',
    files: [file]
  });
}

function closeSnapshotModal() {
  document.getElementById('snapshot-modal').style.display = 'none';
}

/* ------------ info modal ------------ */
function toggleInfoModal() {
  const modal = document.getElementById('info-modal');
  modal.style.display = modal.style.display === 'block' ? 'none' : 'block';
}

/* ------------ TRY ALL logic ------------ */
function stopAutoTry() {
  autoTryRunning = false;
  if (autoTryTimeout) clearTimeout(autoTryTimeout);
  autoTryTimeout = null;
  if (tryAllBtn) {
    tryAllBtn.classList.remove('active');
    tryAllBtn.textContent = 'Try All';
  }
}

function toggleTryAll() {
  if (autoTryRunning) {
    stopAutoTry();
  } else {
    startAutoTry();
  }
}

async function startAutoTry() {
  if (!currentType) {
    alert('Please choose Gold / Diamond and a jewelry type first.');
    return;
  }

  const list = buildImageList(currentType);
  if (!list.length) {
    alert('No items found for this category.');
    return;
  }

  autoSnapshots = [];
  autoTryIndex = 0;
  autoTryRunning = true;
  tryAllBtn.classList.add('active');
  tryAllBtn.textContent = 'Stop';

  const step = async () => {
    if (!autoTryRunning) return;

    const src = list[autoTryIndex];

    if (currentType.includes('earrings')) {
      await changeEarring(src);
    } else {
      await changeNecklace(src);
    }

    await new Promise(res => setTimeout(res, 800));

    triggerFlash();
    if (smoothedLandmarks) {
      const dataURL = captureSnapshotDataURL();
      autoSnapshots.push(dataURL);
    }

    autoTryIndex++;
    if (autoTryIndex >= list.length) {
      stopAutoTry();
      openGallery();
      return;
    }

    autoTryTimeout = setTimeout(step, 2000);
  };

  step();
}

/* ------------ Gallery (after TRY ALL) ------------ */
function openGallery() {
  if (!autoSnapshots.length) {
    alert('No snapshots captured.');
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
  galleryMain.src = src;

  const thumbs = galleryThumbs.querySelectorAll('img');
  thumbs.forEach((t, i) => {
    t.classList.toggle('active', i === index);
  });
}

if (galleryClose) {
  galleryClose.addEventListener('click', () => {
    galleryModal.style.display = 'none';
  });
}

/* ------------ Download All (ZIP) from gallery ------------ */
async function downloadAllImages() {
  if (!autoSnapshots.length) {
    alert("No images to download.");
    return;
  }

  const zip = new JSZip();
  const folder = zip.folder("Your_Looks");

  autoSnapshots.forEach((dataURL, index) => {
    const base64Data = dataURL.split(",")[1]; // remove header
    folder.file(`look_${index + 1}.png`, base64Data, { base64: true });
  });

  const content = await zip.generateAsync({ type: "blob" });
  saveAs(content, "OverlayJewels_Looks.zip");
}

/* ------------ Share current image from gallery ------------ */
async function shareCurrentFromGallery() {
  if (!galleryMain.src) {
    alert("No image selected.");
    return;
  }
  if (!navigator.share || !navigator.canShare) {
    alert("Sharing not supported on this device.");
    return;
  }

  const resp = await fetch(galleryMain.src);
  const blob = await resp.blob();
  const file = new File([blob], 'jewelry-look.png', { type: 'image/png' });

  await navigator.share({
    title: 'Jewelry Try-On',
    text: 'Check out my jewellery look!',
    files: [file]
  });
}

/* expose functions globally */
window.toggleCategory = toggleCategory;
window.selectJewelryType = selectJewelryType;
window.takeSnapshot = takeSnapshot;
window.saveSnapshot = saveSnapshot;
window.shareSnapshot = shareSnapshot;
window.closeSnapshotModal = closeSnapshotModal;
window.toggleInfoModal = toggleInfoModal;
window.toggleTryAll = toggleTryAll;
window.downloadAllImages = downloadAllImages;
window.shareCurrentFromGallery = shareCurrentFromGallery;
