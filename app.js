import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

const els = {
  video: document.getElementById("video"),
  skeletonCanvas: document.getElementById("skeletonCanvas"),
  annotationCanvas: document.getElementById("annotationCanvas"),
  stage: document.getElementById("stage"),
  stageWrap: document.getElementById("stageWrap"),
  fileInput: document.getElementById("fileInput"),
  playPauseBtn: document.getElementById("playPauseBtn"),
  muteBtn: document.getElementById("muteBtn"),
  seek: document.getElementById("seek"),
  skeletonToggle: document.getElementById("skeletonToggle"),
  drawToggle: document.getElementById("drawToggle"),
  toolbar: document.getElementById("toolbar"),
  toolPen: document.getElementById("toolPen"),
  toolText: document.getElementById("toolText"),
  colorPicker: document.getElementById("colorPicker"),
  undoBtn: document.getElementById("undoBtn"),
  clearBtn: document.getElementById("clearBtn"),
  saveBtn: document.getElementById("saveBtn"),
  status: document.getElementById("status"),
  emptyState: document.getElementById("emptyState"),
  personHint: document.getElementById("personHint"),
  personHintText: document.getElementById("personHintText"),
  personResetBtn: document.getElementById("personResetBtn"),
};

const skCtx = els.skeletonCanvas.getContext("2d");
const anCtx = els.annotationCanvas.getContext("2d");

let poseLandmarker = null;
let poseLandmarkerLoading = null;
let skeletonEnabled = true;
let drawMode = false;
let rafId = null;
let lastVideoTime = -1;

let currentTool = "pen";
let currentColor = "#ff3b30";
const strokeWidth = 4;
let history = [];
let currentPath = null;
let pointerActive = false;
let activeTextInput = null;

const MAX_POSES = 5;
let lastPoses = []; // [{ landmarks, centroid: {x,y} }] from the most recent detection
let selectedCentroid = null; // normalized {x,y} of the person currently tracked

function setStatus(msg) {
  els.status.textContent = msg;
  els.status.hidden = !msg;
}

async function createLandmarker(delegate) {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    numPoses: MAX_POSES,
  });
}

function ensurePoseLandmarker() {
  if (poseLandmarker) return Promise.resolve(poseLandmarker);
  if (poseLandmarkerLoading) return poseLandmarkerLoading;
  setStatus("AIモデルを読み込み中…");
  poseLandmarkerLoading = (async () => {
    try {
      poseLandmarker = await createLandmarker("GPU");
    } catch (err) {
      console.warn("GPU delegate failed, falling back to CPU", err);
      poseLandmarker = await createLandmarker("CPU");
    }
    setStatus("");
    return poseLandmarker;
  })().catch((err) => {
    console.error(err);
    setStatus("AIモデルの読み込みに失敗しました(通信環境をご確認ください)");
    poseLandmarkerLoading = null;
    throw err;
  });
  return poseLandmarkerLoading;
}

// ---- File load ----
els.fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  els.video.src = url;
  els.emptyState.hidden = true;
  els.playPauseBtn.disabled = false;
  els.muteBtn.disabled = false;
  els.seek.disabled = false;
});

els.video.addEventListener("loadedmetadata", () => {
  const w = els.video.videoWidth;
  const h = els.video.videoHeight;
  els.skeletonCanvas.width = w;
  els.skeletonCanvas.height = h;
  els.annotationCanvas.width = w;
  els.annotationCanvas.height = h;
  els.seek.max = els.video.duration || 0;
  clearAnnotations();
  updateStageSize();
  lastPoses = [];
  selectedCentroid = null;
  updatePersonHint();
  updateMuteBtn();
  if (skeletonEnabled) ensurePoseLandmarker().then(detectOnce);
});

function updateStageSize() {
  const vw = els.video.videoWidth || 16;
  const vh = els.video.videoHeight || 9;
  const availW = els.stageWrap.clientWidth;
  const availH = els.stageWrap.clientHeight;
  const ratio = vw / vh;
  let w = availW;
  let h = w / ratio;
  if (h > availH) {
    h = availH;
    w = h * ratio;
  }
  els.stage.style.width = `${Math.floor(w)}px`;
  els.stage.style.height = `${Math.floor(h)}px`;
}

window.addEventListener("resize", updateStageSize);
window.addEventListener("orientationchange", updateStageSize);
new ResizeObserver(updateStageSize).observe(els.stageWrap);

// ---- Playback ----
els.video.addEventListener("play", () => {
  els.playPauseBtn.textContent = "⏸ 一時停止";
  if (skeletonEnabled) startLoop();
});
els.video.addEventListener("pause", () => {
  els.playPauseBtn.textContent = "▶ 再生";
  stopLoop();
});
els.video.addEventListener("timeupdate", () => {
  els.seek.value = els.video.currentTime;
});
els.video.addEventListener("ended", () => {
  els.playPauseBtn.textContent = "▶ 再生";
});

els.playPauseBtn.addEventListener("click", () => {
  if (!els.video.src) return;
  if (els.video.paused) {
    els.video.play();
  } else {
    els.video.pause();
  }
});

els.muteBtn.addEventListener("click", () => {
  els.video.muted = !els.video.muted;
  updateMuteBtn();
});

function updateMuteBtn() {
  els.muteBtn.textContent = els.video.muted ? "🔇" : "🔊";
}

els.seek.addEventListener("input", () => {
  els.video.currentTime = Number(els.seek.value);
  if (skeletonEnabled && els.video.paused) detectOnce();
});

// ---- Skeleton toggle ----
els.skeletonToggle.addEventListener("change", () => {
  skeletonEnabled = els.skeletonToggle.checked;
  if (skeletonEnabled) {
    ensurePoseLandmarker().then(() => {
      if (!els.video.paused) startLoop();
      else detectOnce();
    });
  } else {
    stopLoop();
    skCtx.clearRect(0, 0, els.skeletonCanvas.width, els.skeletonCanvas.height);
    lastPoses = [];
    selectedCentroid = null;
    updatePersonHint();
  }
});

// ---- Draw mode toggle (誤操作防止のため明示切替) ----
els.drawToggle.addEventListener("change", () => {
  drawMode = els.drawToggle.checked;
  els.toolbar.hidden = !drawMode;
  els.annotationCanvas.style.pointerEvents = drawMode ? "auto" : "none";
  if (drawMode && !els.video.paused) {
    els.video.pause();
  }
});

// ---- Pose detection loop ----
function startLoop() {
  if (rafId != null) return;
  const loop = () => {
    rafId = requestAnimationFrame(loop);
    if (!skeletonEnabled || els.video.paused || els.video.ended || !els.video.videoWidth) return;
    if (els.video.currentTime === lastVideoTime) return;
    lastVideoTime = els.video.currentTime;
    detectOnce();
  };
  rafId = requestAnimationFrame(loop);
}

function stopLoop() {
  if (rafId != null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

async function detectOnce() {
  if (!skeletonEnabled || !els.video.videoWidth) return;
  try {
    const pl = await ensurePoseLandmarker();
    const result = pl.detectForVideo(els.video, performance.now());
    drawSkeleton(result);
  } catch (err) {
    console.error(err);
  }
}

function computeCentroid(landmarks) {
  let sx = 0;
  let sy = 0;
  for (const lm of landmarks) {
    sx += lm.x;
    sy += lm.y;
  }
  return { x: sx / landmarks.length, y: sy / landmarks.length };
}

function centroidDist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function drawPose(drawingUtils, pose, highlighted, faint) {
  const lineColor = faint ? "rgba(255,255,255,0.25)" : highlighted ? "#00e5ff" : "#8fd3ff";
  drawingUtils.drawConnectors(pose.landmarks, PoseLandmarker.POSE_CONNECTIONS, {
    color: lineColor,
    lineWidth: highlighted ? 4 : 2,
  });
  if (!faint) {
    drawingUtils.drawLandmarks(pose.landmarks, {
      color: highlighted ? "#ffeb3b" : "rgba(255,255,255,0.65)",
      radius: highlighted ? 4 : 3,
    });
  }
}

function drawBadge(n, centroid) {
  const x = centroid.x * els.skeletonCanvas.width;
  const y = centroid.y * els.skeletonCanvas.height;
  skCtx.save();
  skCtx.fillStyle = "rgba(0,0,0,0.7)";
  skCtx.beginPath();
  skCtx.arc(x, y, 18, 0, Math.PI * 2);
  skCtx.fill();
  skCtx.fillStyle = "#ffeb3b";
  skCtx.font = "bold 20px sans-serif";
  skCtx.textAlign = "center";
  skCtx.textBaseline = "middle";
  skCtx.fillText(String(n), x, y);
  skCtx.restore();
}

function updatePersonHint(count = 0, hasSelection = false) {
  if (count > 1) {
    els.personHint.hidden = false;
    els.personHintText.textContent = hasSelection
      ? "対象を追跡中(別の人をタップすると切り替えられます)"
      : `${count}人を検知しました。対象をタップして選択してください`;
    els.personResetBtn.hidden = !hasSelection;
  } else {
    els.personHint.hidden = true;
  }
}

function drawSkeleton(result) {
  const poses = (result.landmarks || []).map((landmarks) => ({
    landmarks,
    centroid: computeCentroid(landmarks),
  }));
  lastPoses = poses;
  renderPoses(poses);
}

function renderPoses(poses) {
  skCtx.save();
  skCtx.clearRect(0, 0, els.skeletonCanvas.width, els.skeletonCanvas.height);
  const drawingUtils = new DrawingUtils(skCtx);

  if (poses.length === 0) {
    updatePersonHint();
  } else if (poses.length === 1) {
    selectedCentroid = poses[0].centroid;
    drawPose(drawingUtils, poses[0], true, false);
    updatePersonHint();
  } else if (!selectedCentroid) {
    poses.forEach((p, i) => {
      drawPose(drawingUtils, p, false, false);
      drawBadge(i + 1, p.centroid);
    });
    updatePersonHint(poses.length, false);
  } else {
    let best = poses[0];
    let bestDist = Infinity;
    for (const p of poses) {
      const d = centroidDist(p.centroid, selectedCentroid);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    for (const p of poses) {
      if (p !== best) drawPose(drawingUtils, p, false, true);
    }
    selectedCentroid = best.centroid;
    drawPose(drawingUtils, best, true, false);
    updatePersonHint(poses.length, true);
  }

  skCtx.restore();
}

// ---- Target person selection (tap to choose who to track) ----
els.skeletonCanvas.addEventListener("click", (evt) => {
  if (!skeletonEnabled || drawMode || !lastPoses.length) return;
  const rect = els.skeletonCanvas.getBoundingClientRect();
  const pt = {
    x: (evt.clientX - rect.left) / rect.width,
    y: (evt.clientY - rect.top) / rect.height,
  };
  let best = null;
  let bestDist = Infinity;
  for (const p of lastPoses) {
    const d = centroidDist(p.centroid, pt);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  if (best) {
    selectedCentroid = { ...best.centroid };
    renderPoses(lastPoses);
  }
});

els.personResetBtn.addEventListener("click", () => {
  selectedCentroid = null;
  renderPoses(lastPoses);
});

// ---- Annotation drawing ----
function canvasPoint(evt) {
  const rect = els.annotationCanvas.getBoundingClientRect();
  const scaleX = els.annotationCanvas.width / rect.width;
  const scaleY = els.annotationCanvas.height / rect.height;
  return {
    x: (evt.clientX - rect.left) * scaleX,
    y: (evt.clientY - rect.top) * scaleY,
  };
}

els.annotationCanvas.addEventListener("pointerdown", (evt) => {
  if (!drawMode) return;
  evt.preventDefault();
  const pt = canvasPoint(evt);
  if (currentTool === "text") {
    openTextInput(pt, evt);
    return;
  }
  pointerActive = true;
  els.annotationCanvas.setPointerCapture(evt.pointerId);
  currentPath = { type: "path", points: [pt], color: currentColor, width: strokeWidth };
});

els.annotationCanvas.addEventListener("pointermove", (evt) => {
  if (!drawMode || !pointerActive || !currentPath) return;
  const pt = canvasPoint(evt);
  currentPath.points.push(pt);
  redrawAnnotations();
});

function endStroke() {
  if (!pointerActive || !currentPath) return;
  pointerActive = false;
  if (currentPath.points.length > 1) history.push(currentPath);
  currentPath = null;
}
els.annotationCanvas.addEventListener("pointerup", endStroke);
els.annotationCanvas.addEventListener("pointercancel", endStroke);
els.annotationCanvas.addEventListener("pointerleave", endStroke);

function openTextInput(pt, evt) {
  if (activeTextInput) return;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "text-input-overlay";
  input.style.left = `${evt.clientX}px`;
  input.style.top = `${evt.clientY}px`;
  input.style.color = currentColor;
  document.body.appendChild(input);
  input.focus();
  activeTextInput = input;

  function commit() {
    const text = input.value.trim();
    if (text) {
      history.push({ type: "text", x: pt.x, y: pt.y, text, color: currentColor, size: 28 });
      redrawAnnotations();
    }
    input.remove();
    activeTextInput = null;
  }
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    }
    if (e.key === "Escape") {
      input.remove();
      activeTextInput = null;
    }
  });
  input.addEventListener("blur", commit);
}

function redrawAnnotations() {
  anCtx.clearRect(0, 0, els.annotationCanvas.width, els.annotationCanvas.height);
  for (const item of history) drawItem(item);
  if (currentPath) drawItem(currentPath);
}

function drawItem(item) {
  if (item.type === "path") {
    anCtx.strokeStyle = item.color;
    anCtx.lineWidth = item.width;
    anCtx.lineCap = "round";
    anCtx.lineJoin = "round";
    anCtx.beginPath();
    item.points.forEach((p, i) => {
      if (i === 0) anCtx.moveTo(p.x, p.y);
      else anCtx.lineTo(p.x, p.y);
    });
    anCtx.stroke();
  } else if (item.type === "text") {
    anCtx.fillStyle = item.color;
    anCtx.font = "bold 28px sans-serif";
    anCtx.textBaseline = "top";
    anCtx.fillText(item.text, item.x, item.y);
  }
}

function clearAnnotations() {
  history = [];
  redrawAnnotations();
}

els.undoBtn.addEventListener("click", () => {
  history.pop();
  redrawAnnotations();
});
els.clearBtn.addEventListener("click", clearAnnotations);

els.toolPen.addEventListener("click", () => setTool("pen"));
els.toolText.addEventListener("click", () => setTool("text"));
function setTool(tool) {
  currentTool = tool;
  els.toolPen.classList.toggle("active", tool === "pen");
  els.toolText.classList.toggle("active", tool === "text");
}

els.colorPicker.addEventListener("input", () => {
  currentColor = els.colorPicker.value;
});

// ---- Save composite image ----
els.saveBtn.addEventListener("click", () => {
  const w = els.annotationCanvas.width;
  const h = els.annotationCanvas.height;
  if (!w || !h) return;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const octx = out.getContext("2d");
  octx.drawImage(els.video, 0, 0, w, h);
  if (skeletonEnabled) octx.drawImage(els.skeletonCanvas, 0, 0);
  octx.drawImage(els.annotationCanvas, 0, 0);
  out.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = url;
    a.download = `motion-check-${ts}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
});
