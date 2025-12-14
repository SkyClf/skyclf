<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import logoSvg from "./assets/SkyClfLogo.svg";

// ============ Types ============
interface TrainConfig {
  epochs: number;
  batch_size: number;
  lr: string;
  img_size: number;
}

interface TrainStatus {
  running: boolean;
  container_id?: string;
  started_at?: string;
  exit_code?: number;
  error?: string;
  logs?: string;
  last_config?: TrainConfig;
}

interface ImageItem {
  id: string;
  path: string;
  sha256: string;
  fetched_at: string;
  skystate?: string;
  meteor?: boolean;
  labeled_at?: string;
}

interface ModelInfo {
  active: string | null;
  path?: string;
}

// ============ State ============
const activeTab = ref<"label" | "train">("label");

// Labeling state
const images = ref<ImageItem[]>([]);
const currentIndex = ref(0);
const showUnlabeledOnly = ref(true);
const labeledCount = ref(0);
const totalCount = ref(0);
const labeling = ref(false);

// Training state
const status = ref<TrainStatus>({ running: false });
const loading = ref(false);
const error = ref("");
const epochs = ref(10);
const batchSize = ref(16);
const learningRate = ref("0.001");
const modelInfo = ref<ModelInfo>({ active: null });

let pollInterval: number | null = null;

// ============ Computed ============
const currentImage = computed(() => images.value[currentIndex.value] || null);
const hasNext = computed(() => currentIndex.value < images.value.length - 1);
const hasPrev = computed(() => currentIndex.value > 0);
const progress = computed(() => {
  if (images.value.length === 0) return 100;
  return Math.round(
    (labeledCount.value / (labeledCount.value + images.value.length)) * 100
  );
});

const skystateOptions = [
  {
    value: "clear",
    label: "Clear",
    icon: "mdi-weather-sunny",
    color: "#fbbf24",
    key: "1",
  },
  {
    value: "light_clouds",
    label: "Light Clouds",
    icon: "mdi-weather-partly-cloudy",
    color: "#60a5fa",
    key: "2",
  },
  {
    value: "heavy_clouds",
    label: "Heavy Clouds",
    icon: "mdi-weather-cloudy",
    color: "#6b7280",
    key: "3",
  },
  {
    value: "precipitation",
    label: "Precipitation",
    icon: "mdi-weather-rainy",
    color: "#3b82f6",
    key: "4",
  },
  {
    value: "unknown",
    label: "Unknown",
    icon: "mdi-help-circle",
    color: "#8b5cf6",
    key: "5",
  },
];

// ============ Labeling Functions ============
async function fetchImages() {
  try {
    const params = new URLSearchParams({ limit: "1000" });
    if (showUnlabeledOnly.value) params.set("unlabeled", "1");

    const res = await fetch(`/api/dataset/images?${params}`);
    if (res.ok) {
      const data = await res.json();
      images.value = data.items || [];
      totalCount.value = data.count || 0;
    }
  } catch (e) {
    console.error("Failed to fetch images:", e);
  }
}

async function fetchStats() {
  try {
    const res = await fetch("/api/dataset/images?limit=10000");
    if (res.ok) {
      const data = await res.json();
      const items = data.items || [];
      labeledCount.value = items.filter((i: ImageItem) => i.skystate).length;
    }
  } catch (e) {
    console.error("Failed to fetch stats:", e);
  }
}

async function fetchModelInfo() {
  try {
    const res = await fetch("/api/models");
    if (res.ok) {
      modelInfo.value = await res.json();
    }
  } catch (e) {
    console.error("Failed to fetch model info:", e);
  }
}

async function setLabel(skystate: string, meteor: boolean = false) {
  if (!currentImage.value || labeling.value) return;

  labeling.value = true;
  try {
    const res = await fetch("/api/labels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_id: currentImage.value.id,
        skystate,
        meteor,
      }),
    });

    if (res.ok) {
      if (showUnlabeledOnly.value) {
        images.value.splice(currentIndex.value, 1);
        if (
          currentIndex.value >= images.value.length &&
          images.value.length > 0
        ) {
          currentIndex.value = images.value.length - 1;
        }
      } else {
        const img = images.value[currentIndex.value];
        if (img) {
          img.skystate = skystate;
          img.meteor = meteor;
        }
        nextImage();
      }
      labeledCount.value++;
    }
  } catch (e) {
    console.error("Failed to set label:", e);
  } finally {
    labeling.value = false;
  }
}

function nextImage() {
  if (hasNext.value) currentIndex.value++;
}

function prevImage() {
  if (hasPrev.value) currentIndex.value--;
}

function handleKeydown(e: KeyboardEvent) {
  if ((e.target as HTMLElement).tagName === "INPUT") return;

  if (activeTab.value !== "label" || !currentImage.value) return;

  const keyIndex = parseInt(e.key) - 1;
  if (keyIndex >= 0 && keyIndex < skystateOptions.length) {
    const opt = skystateOptions[keyIndex];
    if (opt) setLabel(opt.value);
    return;
  }

  if (e.key === "ArrowRight" || e.key === "d" || e.key === " ") {
    e.preventDefault();
    nextImage();
  }
  if (e.key === "ArrowLeft" || e.key === "a") {
    e.preventDefault();
    prevImage();
  }

  if (e.key === "m" || e.key === "M") {
    const currentSkystate = currentImage.value.skystate || "unknown";
    setLabel(currentSkystate, true);
  }
}

// ============ Training Functions ============
async function fetchStatus() {
  try {
    const res = await fetch("/api/train/status");
    if (res.ok) {
      status.value = await res.json();
    }
  } catch (e) {
    console.error("Failed to fetch status:", e);
  }
}

async function startTraining() {
  loading.value = true;
  error.value = "";
  try {
    const res = await fetch("/api/train/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        epochs: epochs.value,
        batch_size: batchSize.value,
        lr: learningRate.value,
        img_size: 224,
        seed: 42,
        val_split: "0.2",
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      error.value = data.error || "Failed to start training";
    }
    await fetchStatus();
  } catch (e) {
    error.value = "Network error";
  } finally {
    loading.value = false;
  }
}

async function stopTraining() {
  loading.value = true;
  error.value = "";
  try {
    const res = await fetch("/api/train/stop", { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      error.value = data.error || "Failed to stop training";
    }
    await fetchStatus();
  } catch (e) {
    error.value = "Network error";
  } finally {
    loading.value = false;
  }
}

async function reloadModels() {
  try {
    await fetch("/api/models/reload", { method: "POST" });
    await fetchModelInfo();
  } catch (e) {
    console.error("Failed to reload models:", e);
  }
}

// ============ Lifecycle ============
onMounted(() => {
  fetchImages();
  fetchStats();
  fetchStatus();
  fetchModelInfo();
  pollInterval = window.setInterval(() => {
    fetchStatus();
    fetchModelInfo();
    if (activeTab.value === "label") fetchStats();
  }, 3000);

  window.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
  if (pollInterval) clearInterval(pollInterval);
  window.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <div class="app">
    <!-- Sidebar -->
    <aside class="sidebar">
      <div class="logo">
        <img :src="logoSvg" alt="SkyClf" class="logo-img" />
        <span class="logo-text">SkyClf</span>
      </div>

      <nav class="nav">
        <button
          :class="['nav-item', { active: activeTab === 'label' }]"
          @click="
            activeTab = 'label';
            fetchImages();
          "
        >
          <span class="mdi mdi-tag-multiple"></span>
          <span>Label</span>
        </button>
        <button
          :class="['nav-item', { active: activeTab === 'train' }]"
          @click="activeTab = 'train'"
        >
          <span class="mdi mdi-brain"></span>
          <span>Train</span>
        </button>
      </nav>

      <div class="sidebar-stats">
        <div class="stat-item">
          <span class="mdi mdi-image-multiple"></span>
          <div class="stat-content">
            <span class="stat-value">{{ images.length }}</span>
            <span class="stat-label">Unlabeled</span>
          </div>
        </div>
        <div class="stat-item">
          <span class="mdi mdi-check-circle"></span>
          <div class="stat-content">
            <span class="stat-value">{{ labeledCount }}</span>
            <span class="stat-label">Labeled</span>
          </div>
        </div>
        <div class="stat-item">
          <span class="mdi mdi-cube"></span>
          <div class="stat-content">
            <span class="stat-value">{{ modelInfo.active || "None" }}</span>
            <span class="stat-label">Model</span>
          </div>
        </div>
      </div>

      <div class="progress-section">
        <div class="progress-header">
          <span>Progress</span>
          <span>{{ progress }}%</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: progress + '%' }"></div>
        </div>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="main">
      <!-- Label View -->
      <div v-if="activeTab === 'label'" class="label-view">
        <!-- Toolbar -->
        <div class="toolbar">
          <div class="toolbar-left">
            <h1>Label Images</h1>
          </div>
          <div class="toolbar-right">
            <label class="toggle">
              <input
                type="checkbox"
                v-model="showUnlabeledOnly"
                @change="
                  fetchImages();
                  currentIndex = 0;
                "
              />
              <span class="toggle-slider"></span>
              <span class="toggle-label">Unlabeled only</span>
            </label>
            <button class="icon-btn" @click="fetchImages()" title="Refresh">
              <span class="mdi mdi-refresh"></span>
            </button>
          </div>
        </div>

        <!-- Empty State -->
        <div v-if="images.length === 0" class="empty-state">
          <span class="mdi mdi-party-popper empty-icon"></span>
          <h2>{{ showUnlabeledOnly ? "All Done!" : "No Images" }}</h2>
          <p>
            {{
              showUnlabeledOnly
                ? "All images have been labeled."
                : "Images will appear here as they are captured."
            }}
          </p>
        </div>

        <!-- Labeling Interface -->
        <div v-else class="labeling-interface">
          <!-- Image Panel -->
          <div class="image-panel">
            <div class="image-wrapper">
              <img
                v-if="currentImage"
                :src="`/images/${currentImage.id}.jpg`"
                :alt="currentImage.id"
                class="main-image"
              />

              <!-- Navigation Overlay -->
              <button
                class="nav-overlay nav-prev"
                @click="prevImage"
                :disabled="!hasPrev"
              >
                <span class="mdi mdi-chevron-left"></span>
              </button>
              <button
                class="nav-overlay nav-next"
                @click="nextImage"
                :disabled="!hasNext"
              >
                <span class="mdi mdi-chevron-right"></span>
              </button>

              <!-- Current Label Badge -->
              <div v-if="currentImage?.skystate" class="current-badge">
                <span
                  class="mdi"
                  :class="
                    skystateOptions.find(
                      (o) => o.value === currentImage?.skystate
                    )?.icon
                  "
                ></span>
                {{ currentImage.skystate }}
                <span v-if="currentImage.meteor" class="meteor-badge">
                  <span class="mdi mdi-star-shooting"></span>
                </span>
              </div>
            </div>

            <!-- Image Counter -->
            <div class="image-counter">
              <button
                class="counter-btn"
                @click="prevImage"
                :disabled="!hasPrev"
              >
                <span class="mdi mdi-arrow-left"></span>
              </button>
              <span class="counter-text"
                >{{ currentIndex + 1 }} of {{ images.length }}</span
              >
              <button
                class="counter-btn"
                @click="nextImage"
                :disabled="!hasNext"
              >
                <span class="mdi mdi-arrow-right"></span>
              </button>
            </div>
          </div>

          <!-- Controls Panel -->
          <div class="controls-panel">
            <h3>Sky State</h3>
            <div class="label-grid">
              <button
                v-for="opt in skystateOptions"
                :key="opt.value"
                @click="setLabel(opt.value)"
                :disabled="labeling"
                :class="[
                  'label-card',
                  { active: currentImage?.skystate === opt.value },
                ]"
                :style="{ '--accent-color': opt.color }"
              >
                <span class="mdi" :class="opt.icon"></span>
                <span class="label-name">{{ opt.label }}</span>
                <span class="label-key">{{ opt.key }}</span>
              </button>
            </div>

            <div class="divider"></div>

            <h3>Special</h3>
            <button
              @click="setLabel(currentImage?.skystate || 'unknown', true)"
              :disabled="labeling || !currentImage"
              class="meteor-card"
            >
              <span class="mdi mdi-star-shooting"></span>
              <span>Meteor Detected</span>
              <span class="label-key">M</span>
            </button>

            <div class="shortcuts">
              <div class="shortcut">
                <kbd>1-5</kbd>
                <span>Select label</span>
              </div>
              <div class="shortcut">
                <kbd>←</kbd><kbd>→</kbd>
                <span>Navigate</span>
              </div>
              <div class="shortcut">
                <kbd>Space</kbd>
                <span>Next image</span>
              </div>
              <div class="shortcut">
                <kbd>M</kbd>
                <span>Mark meteor</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Train View -->
      <div v-if="activeTab === 'train'" class="train-view">
        <div class="toolbar">
          <div class="toolbar-left">
            <h1>Train Model</h1>
          </div>
          <div class="toolbar-right">
            <button
              class="icon-btn"
              @click="reloadModels()"
              title="Reload Models"
            >
              <span class="mdi mdi-reload"></span>
            </button>
          </div>
        </div>

        <div class="train-content">
          <!-- Status Cards -->
          <div class="status-cards">
            <div class="status-card">
              <span class="mdi mdi-tag-check"></span>
              <div class="status-info">
                <span class="status-value">{{ labeledCount }}</span>
                <span class="status-label">Labeled Images</span>
              </div>
            </div>
            <div class="status-card">
              <span class="mdi mdi-cube-outline"></span>
              <div class="status-info">
                <span class="status-value">{{
                  modelInfo.active || "None"
                }}</span>
                <span class="status-label">Current Model</span>
              </div>
            </div>
            <div
              class="status-card"
              :class="{ 'status-running': status.running }"
            >
              <span
                class="mdi"
                :class="
                  status.running ? 'mdi-loading mdi-spin' : 'mdi-check-circle'
                "
              ></span>
              <div class="status-info">
                <span class="status-value">{{
                  status.running ? "Training" : "Idle"
                }}</span>
                <span class="status-label">Status</span>
              </div>
            </div>
          </div>

          <!-- Warning -->
          <div v-if="labeledCount < 10" class="warning-banner">
            <span class="mdi mdi-alert"></span>
            <div>
              <strong>Not enough data</strong>
              <p>
                You need at least 10 labeled images to train. Currently:
                {{ labeledCount }}
              </p>
            </div>
          </div>

          <!-- Config Form -->
          <div class="config-section" v-if="!status.running">
            <h2>Configuration</h2>
            <div class="config-grid">
              <div class="config-field">
                <label>
                  <span class="mdi mdi-repeat"></span>
                  Epochs
                </label>
                <input type="number" v-model="epochs" min="1" max="1000" />
                <span class="field-hint">Training iterations</span>
              </div>
              <div class="config-field">
                <label>
                  <span class="mdi mdi-package-variant"></span>
                  Batch Size
                </label>
                <input type="number" v-model="batchSize" min="1" max="256" />
                <span class="field-hint">Images per batch</span>
              </div>
              <div class="config-field">
                <label>
                  <span class="mdi mdi-speedometer"></span>
                  Learning Rate
                </label>
                <input type="text" v-model="learningRate" />
                <span class="field-hint">Step size (e.g. 0.001)</span>
              </div>
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="actions">
            <button
              v-if="!status.running"
              @click="startTraining"
              :disabled="loading || labeledCount < 10"
              class="btn-primary"
            >
              <span class="mdi mdi-play"></span>
              {{ loading ? "Starting..." : "Start Training" }}
            </button>
            <button
              v-else
              @click="stopTraining"
              :disabled="loading"
              class="btn-danger"
            >
              <span class="mdi mdi-stop"></span>
              {{ loading ? "Stopping..." : "Stop Training" }}
            </button>
          </div>

          <!-- Error Message -->
          <div v-if="error" class="error-message">
            <span class="mdi mdi-alert-circle"></span>
            {{ error }}
          </div>

          <!-- Training Status -->
          <div v-if="status.running" class="training-status">
            <div class="training-header">
              <span class="mdi mdi-loading mdi-spin"></span>
              <span>Training in progress...</span>
            </div>
            <p v-if="status.started_at" class="training-time">
              Started {{ new Date(status.started_at).toLocaleString() }}
            </p>
          </div>

          <div v-else-if="status.exit_code === 0" class="success-status">
            <span class="mdi mdi-check-circle"></span>
            <span>Training completed successfully!</span>
          </div>

          <div
            v-else-if="status.exit_code !== undefined && status.exit_code !== 0"
            class="failed-status"
          >
            <span class="mdi mdi-close-circle"></span>
            <span>Training failed (exit code: {{ status.exit_code }})</span>
          </div>

          <!-- Logs -->
          <div v-if="status.logs" class="logs-section">
            <h3>
              <span class="mdi mdi-console"></span>
              Logs
            </h3>
            <pre class="logs-content">{{ status.logs }}</pre>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<style>
@import url("https://cdn.jsdelivr.net/npm/@mdi/font@7.4.47/css/materialdesignicons.min.css");

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html,
body,
#app {
  height: 100%;
  width: 100%;
  overflow: hidden;
}

body {
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    sans-serif;
  background: #0a0a0f;
  color: #e4e4e7;
}

.app {
  display: flex;
  height: 100vh;
  width: 100vw;
}

/* Sidebar */
.sidebar {
  width: 240px;
  background: #111118;
  border-right: 1px solid #27272a;
  display: flex;
  flex-direction: column;
  padding: 1.5rem 1rem;
  flex-shrink: 0;
}

.logo {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0 0.5rem;
  margin-bottom: 2rem;
}

.logo .mdi {
  font-size: 2rem;
  color: #8b5cf6;
}

.logo-img {
  width: 36px;
  height: 36px;
  object-fit: contain;
}

.logo-text {
  font-size: 1.5rem;
  font-weight: 700;
  background: linear-gradient(135deg, #8b5cf6, #6366f1);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 2rem;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.875rem 1rem;
  border: none;
  border-radius: 12px;
  background: transparent;
  color: #71717a;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.nav-item .mdi {
  font-size: 1.25rem;
}

.nav-item:hover {
  background: #18181b;
  color: #e4e4e7;
}

.nav-item.active {
  background: linear-gradient(
    135deg,
    rgba(139, 92, 246, 0.2),
    rgba(99, 102, 241, 0.2)
  );
  color: #a78bfa;
}

.sidebar-stats {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 2rem;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  background: #18181b;
  border-radius: 10px;
}

.stat-item .mdi {
  font-size: 1.25rem;
  color: #71717a;
}

.stat-content {
  display: flex;
  flex-direction: column;
}

.stat-value {
  font-size: 1rem;
  font-weight: 600;
  color: #fafafa;
}

.stat-label {
  font-size: 0.75rem;
  color: #71717a;
}

.progress-section {
  margin-top: auto;
  padding: 1rem;
  background: #18181b;
  border-radius: 12px;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  font-size: 0.8125rem;
  color: #a1a1aa;
  margin-bottom: 0.5rem;
}

.progress-bar {
  height: 6px;
  background: #27272a;
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #8b5cf6, #6366f1);
  border-radius: 3px;
  transition: width 0.3s ease;
}

/* Main Content */
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.25rem 2rem;
  border-bottom: 1px solid #27272a;
  background: #111118;
}

.toolbar h1 {
  font-size: 1.5rem;
  font-weight: 600;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.toggle {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  cursor: pointer;
}

.toggle input {
  display: none;
}

.toggle-slider {
  width: 44px;
  height: 24px;
  background: #27272a;
  border-radius: 12px;
  position: relative;
  transition: background 0.2s;
}

.toggle-slider::after {
  content: "";
  position: absolute;
  width: 18px;
  height: 18px;
  background: #52525b;
  border-radius: 50%;
  top: 3px;
  left: 3px;
  transition: all 0.2s;
}

.toggle input:checked + .toggle-slider {
  background: #8b5cf6;
}

.toggle input:checked + .toggle-slider::after {
  transform: translateX(20px);
  background: white;
}

.toggle-label {
  font-size: 0.875rem;
  color: #a1a1aa;
}

.icon-btn {
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 10px;
  background: #18181b;
  color: #a1a1aa;
  font-size: 1.25rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.icon-btn:hover {
  background: #27272a;
  color: #fafafa;
}

/* Label View */
.label-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #71717a;
}

.empty-icon {
  font-size: 4rem;
  margin-bottom: 1rem;
  color: #8b5cf6;
}

.empty-state h2 {
  font-size: 1.5rem;
  color: #fafafa;
  margin-bottom: 0.5rem;
}

.empty-state p {
  font-size: 0.9375rem;
}

/* Labeling Interface */
.labeling-interface {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 320px;
  overflow: hidden;
}

.image-panel {
  display: flex;
  flex-direction: column;
  padding: 1.5rem;
  background: #0a0a0f;
}

.image-wrapper {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
  border-radius: 16px;
  overflow: hidden;
  min-height: 0;
}

.main-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.nav-overlay {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 80px;
  border: none;
  background: transparent;
  color: white;
  font-size: 2.5rem;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nav-overlay:hover:not(:disabled) {
  opacity: 1;
  background: linear-gradient(90deg, rgba(0, 0, 0, 0.5), transparent);
}

.nav-prev {
  left: 0;
}

.nav-next {
  right: 0;
}

.nav-next:hover:not(:disabled) {
  background: linear-gradient(-90deg, rgba(0, 0, 0, 0.5), transparent);
}

.nav-overlay:disabled {
  cursor: default;
}

.current-badge {
  position: absolute;
  bottom: 1rem;
  left: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
  text-transform: capitalize;
}

.meteor-badge {
  color: #fbbf24;
}

.image-counter {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 1rem;
}

.counter-btn {
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 8px;
  background: #18181b;
  color: #a1a1aa;
  font-size: 1.25rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.counter-btn:hover:not(:disabled) {
  background: #27272a;
  color: #fafafa;
}

.counter-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.counter-text {
  font-size: 0.875rem;
  color: #71717a;
  min-width: 80px;
  text-align: center;
}

/* Controls Panel */
.controls-panel {
  background: #111118;
  border-left: 1px solid #27272a;
  padding: 1.5rem;
  overflow-y: auto;
}

.controls-panel h3 {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #71717a;
  margin-bottom: 1rem;
}

.label-grid {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.label-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.875rem 1rem;
  border: 1px solid #27272a;
  border-radius: 12px;
  background: #18181b;
  color: #e4e4e7;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
}

.label-card .mdi {
  font-size: 1.375rem;
  color: var(--accent-color);
}

.label-card:hover:not(:disabled) {
  border-color: var(--accent-color);
  background: rgba(139, 92, 246, 0.1);
}

.label-card.active {
  border-color: #22c55e;
  background: rgba(34, 197, 94, 0.1);
}

.label-card:disabled {
  opacity: 0.5;
  cursor: default;
}

.label-name {
  flex: 1;
}

.label-key {
  font-size: 0.75rem;
  color: #52525b;
  background: #27272a;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.divider {
  height: 1px;
  background: #27272a;
  margin: 1.5rem 0;
}

.meteor-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.875rem 1rem;
  border: 1px dashed #fbbf24;
  border-radius: 12px;
  background: transparent;
  color: #fbbf24;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 1.5rem;
}

.meteor-card .mdi {
  font-size: 1.375rem;
}

.meteor-card span:nth-child(2) {
  flex: 1;
  text-align: left;
}

.meteor-card:hover:not(:disabled) {
  background: rgba(251, 191, 36, 0.1);
}

.meteor-card:disabled {
  opacity: 0.5;
  cursor: default;
}

.shortcuts {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.shortcut {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: #52525b;
}

.shortcut kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 22px;
  padding: 0 0.375rem;
  background: #27272a;
  border-radius: 4px;
  font-family: inherit;
  font-size: 0.6875rem;
  color: #a1a1aa;
}

/* Train View */
.train-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.train-content {
  flex: 1;
  padding: 2rem;
  overflow-y: auto;
  max-width: 800px;
}

.status-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  margin-bottom: 2rem;
}

.status-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.25rem;
  background: #111118;
  border: 1px solid #27272a;
  border-radius: 16px;
}

.status-card .mdi {
  font-size: 1.75rem;
  color: #8b5cf6;
}

.status-card.status-running .mdi {
  color: #3b82f6;
}

.status-info {
  display: flex;
  flex-direction: column;
}

.status-value {
  font-size: 1.125rem;
  font-weight: 600;
  color: #fafafa;
}

.status-label {
  font-size: 0.8125rem;
  color: #71717a;
}

.warning-banner {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  padding: 1rem 1.25rem;
  background: rgba(251, 191, 36, 0.1);
  border: 1px solid rgba(251, 191, 36, 0.3);
  border-radius: 12px;
  margin-bottom: 2rem;
}

.warning-banner .mdi {
  font-size: 1.5rem;
  color: #fbbf24;
  flex-shrink: 0;
}

.warning-banner strong {
  color: #fbbf24;
}

.warning-banner p {
  margin-top: 0.25rem;
  font-size: 0.875rem;
  color: #a1a1aa;
}

.config-section {
  margin-bottom: 2rem;
}

.config-section h2 {
  font-size: 1.125rem;
  font-weight: 600;
  margin-bottom: 1.25rem;
}

.config-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
}

.config-field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.config-field label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: #a1a1aa;
}

.config-field label .mdi {
  font-size: 1rem;
  color: #71717a;
}

.config-field input {
  padding: 0.75rem 1rem;
  border: 1px solid #27272a;
  border-radius: 10px;
  background: #18181b;
  color: #fafafa;
  font-size: 1rem;
  transition: all 0.2s;
}

.config-field input:focus {
  outline: none;
  border-color: #8b5cf6;
}

.field-hint {
  font-size: 0.75rem;
  color: #52525b;
}

.actions {
  margin-bottom: 1.5rem;
}

.btn-primary,
.btn-danger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.875rem 2rem;
  border: none;
  border-radius: 12px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background: linear-gradient(135deg, #8b5cf6, #6366f1);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 20px rgba(139, 92, 246, 0.4);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: default;
}

.btn-danger {
  background: #dc2626;
  color: white;
}

.btn-danger:hover:not(:disabled) {
  background: #b91c1c;
}

.btn-danger:disabled {
  opacity: 0.5;
  cursor: default;
}

.error-message {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  background: rgba(220, 38, 38, 0.1);
  border: 1px solid rgba(220, 38, 38, 0.3);
  border-radius: 10px;
  color: #f87171;
  margin-bottom: 1.5rem;
}

.error-message .mdi {
  font-size: 1.25rem;
}

.training-status,
.success-status,
.failed-status {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  border-radius: 12px;
  margin-bottom: 1.5rem;
}

.training-status {
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.3);
  flex-direction: column;
  align-items: flex-start;
}

.training-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: #60a5fa;
  font-weight: 500;
}

.training-time {
  font-size: 0.875rem;
  color: #71717a;
  margin-top: 0.25rem;
}

.success-status {
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.3);
  color: #4ade80;
}

.failed-status {
  background: rgba(220, 38, 38, 0.1);
  border: 1px solid rgba(220, 38, 38, 0.3);
  color: #f87171;
}

.logs-section {
  margin-top: 1.5rem;
}

.logs-section h3 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  font-weight: 600;
  color: #a1a1aa;
  margin-bottom: 0.75rem;
}

.logs-content {
  padding: 1rem;
  background: #0a0a0f;
  border: 1px solid #27272a;
  border-radius: 10px;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 0.8125rem;
  line-height: 1.6;
  color: #a1a1aa;
  max-height: 400px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

/* Animations */
@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.mdi-spin {
  animation: spin 1s linear infinite;
}

/* Scrollbar */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: #27272a;
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: #3f3f46;
}
</style>
