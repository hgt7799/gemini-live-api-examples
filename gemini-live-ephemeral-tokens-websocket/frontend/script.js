/**
 * Main application script for Gemini Live API Demo
 * Handles UI interactions, media streaming, and communication with Gemini API
 *
 * 길 2: 세션 1개 + 방향 전환 버튼 (↔)
 */

// Global state
const state = {
  client: null,
  myLang: sessionStorage.getItem("myLang") || "ko",
  partnerLang: sessionStorage.getItem("partnerLang") || "en",
  audio: { streamer: null, player: null, isStreaming: false },
  video: { streamer: null, isStreaming: false },
  screen: { capture: null, isSharing: false },
};

// 봉인된 타입 추적 (빈 text 1회 → 봉인, 다음 텍스트는 새 카드)
const sealedTypes = new Set();

// 언어 라벨 맵
const langLabels = {
  ko: "한국어",
  en: "English",
  ja: "日本語",
  "zh-Hans": "中文",
  "zh-Hant": "中文繁",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  it: "Italiano",
  "pt-BR": "Português",
  vi: "Tiếng Việt",
  th: "ภาษาไทย",
  id: "Indonesia",
  ar: "العربية",
  hi: "हिन्दी",
  ru: "Русский",
};

// DOM element cache
const elements = {};

// Initialize DOM references
function initDOM() {
  const ids = [
    "model",
    "systemInstructions",
    "enableInputTranscription",
    "enableOutputTranscription",
    "enableGrounding",
    "enableAlertTool",
    "enableCssStyleTool",
    "voiceSelect",
    "temperature",
    "temperatureValue",
    "disableActivityDetection",
    "silenceDuration",
    "prefixPadding",
    "endSpeechSensitivity",
    "startSpeechSensitivity",
    "activityHandling",
    "connectBtn",
    "disconnectBtn",
    "connectionStatus",
    "startAudioBtn",
    "startVideoBtn",
    "startScreenBtn",
    "videoPreview",
    "micSelect",
    "cameraSelect",
    "volume",
    "volumeValue",
    "chatContainer",
    "chatInput",
    "sendBtn",
    "debugInfo",
    "setupJsonSection",
    "setupJsonDisplay",
    "switchBtn",
    "directionLabel",
  ];

  ids.forEach((id) => {
    elements[id] = document.getElementById(id);
  });
}

// Populate media device selectors
async function populateMediaDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();

    // Clear existing options
    elements.micSelect.innerHTML =
      '<option value="">Default Microphone</option>';
    elements.cameraSelect.innerHTML =
      '<option value="">Default Camera</option>';

    // Add audio input devices
    devices
      .filter((device) => device.kind === "audioinput")
      .forEach((device) => {
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.textContent =
          device.label || `Microphone ${device.deviceId.substr(0, 8)}`;
        elements.micSelect.appendChild(option);
      });

    // Add video input devices
    devices
      .filter((device) => device.kind === "videoinput")
      .forEach((device) => {
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.textContent =
          device.label || `Camera ${device.deviceId.substr(0, 8)}`;
        elements.cameraSelect.appendChild(option);
      });
  } catch (error) {
    console.error("Error enumerating devices:", error);
  }
}

// Create reusable message element
function createMessage(text, className = "") {
  const div = document.createElement("div");
  div.textContent = text;
  if (className) div.className = className;
  return div;
}

// Update status display
function updateStatus(elementId, text) {
  if (elements[elementId]) {
    elements[elementId].textContent = text;
  }
}

// 방향 라벨 + 카드 라벨 갱신
function updateDirectionLabel() {
  const from = langLabels[state.myLang] || state.myLang;
  const to = langLabels[state.partnerLang] || state.partnerLang;
  if (elements.directionLabel) {
    elements.directionLabel.innerHTML = `${from} <span>→</span> ${to}`;
  }
  // 카드 라벨 CSS 변수 갱신 (오른쪽=내 언어, 왼쪽=상대 언어)
  document.documentElement.style.setProperty("--my-lang-label", `"${from}"`);
  document.documentElement.style.setProperty("--partner-lang-label", `"${to}"`);
}

// Connect to Gemini
async function connect() {
  try {
    updateStatus("connectionStatus", "Fetching ephemeral token...");

    // Fetch token from backend (도착 언어를 파라미터로 전달 → 토큰에 박힘)
    const response = await fetch(`/api/token?target=${encodeURIComponent(state.partnerLang)}`, { method: "POST" });
    if (!response.ok) {
      throw new Error(`Failed to fetch token: ${response.statusText}`);
    }
    const { token } = await response.json();
    const model = elements.model.value;

    updateStatus("connectionStatus", "Connecting...");

    // Create GeminiLiveAPI instance
    state.client = new GeminiLiveAPI(token, model);

    // 번역 모드 설정
    state.client.setUseTranslation(true);
    state.client.setTargetLanguageCode(state.partnerLang);
    state.client.setEchoTargetLanguage(true);

    // Configure settings (번역 모드에서는 무시되지만 호환성 유지)
    state.client.systemInstructions = elements.systemInstructions.value;
    state.client.inputAudioTranscription =
      elements.enableInputTranscription.checked;
    state.client.outputAudioTranscription =
      elements.enableOutputTranscription.checked;
    state.client.googleGrounding = elements.enableGrounding.checked;
    state.client.responseModalities = ["AUDIO"];
    state.client.voiceName = elements.voiceSelect.value;
    state.client.temperature = parseFloat(elements.temperature.value);

    // Set automatic activity detection configuration
    state.client.automaticActivityDetection = {
      disabled: elements.disableActivityDetection.checked,
      silence_duration_ms: parseInt(elements.silenceDuration.value),
      prefix_padding_ms: parseInt(elements.prefixPadding.value),
      end_of_speech_sensitivity: elements.endSpeechSensitivity.value,
      start_of_speech_sensitivity: elements.startSpeechSensitivity.value,
    };

    // Set activity handling
    state.client.activityHandling = elements.activityHandling.value;

    // Add custom tools only if Google grounding is disabled
    const isGroundingEnabled = elements.enableGrounding.checked;

    if (!isGroundingEnabled) {
      // Add alert tool if enabled
      if (elements.enableAlertTool.checked) {
        const alertTool = new ShowAlertTool();
        state.client.addFunction(alertTool);
        console.log("✅ Alert tool enabled");
      }

      // Add CSS style tool if enabled
      if (elements.enableCssStyleTool.checked) {
        const cssStyleTool = new AddCSSStyleTool();
        state.client.addFunction(cssStyleTool);
        console.log("✅ CSS style tool enabled");
      }
    } else {
      console.log(
        "⚠️ Custom tools disabled due to Google grounding being enabled"
      );
    }

    // Set callbacks
    state.client.onReceiveResponse = handleMessage;
    state.client.onError = handleError;
    state.client.onOpen = handleOpen;
    state.client.onClose = handleClose;

    await state.client.connect();

    // Initialize media handlers
    state.audio.streamer = new AudioStreamer(state.client);
    state.video.streamer = new VideoStreamer(state.client);
    state.screen.capture = new ScreenCapture(state.client);
    state.audio.player = new AudioPlayer();
    await state.audio.player.init();

    // 봉인 초기화
    sealedTypes.clear();

    updateStatus("debugInfo", "Connected successfully");
  } catch (error) {
    console.error("Connection failed:", error);
    updateStatus("connectionStatus", "Connection failed: " + error.message);
    updateStatus("debugInfo", "Error: " + error.message);
  }
}

// Disconnect
function disconnect() {
  if (state.client) {
    // 콜백 제거: 비동기 onclose가 새 연결을 죽이는 것 방지
    state.client.onClose = () => {};
    state.client.onError = () => {};
    if (state.client.webSocket) {
      state.client.webSocket.close();
    }
    state.client = null;
  }

  // Stop all streams
  if (state.audio.streamer) state.audio.streamer.stop();
  if (state.video.streamer) state.video.streamer.stop();
  if (state.screen.capture) state.screen.capture.stop();

  // Reset states
  state.audio.isStreaming = false;
  state.video.isStreaming = false;
  state.screen.isSharing = false;

  // Update UI
  updateStatus("connectionStatus", "Disconnected");

  elements.startAudioBtn.textContent = "Start Audio";
  elements.startVideoBtn.textContent = "Start Video";
  elements.startScreenBtn.textContent = "Share Screen";

  elements.videoPreview.hidden = true;
  elements.videoPreview.srcObject = null;
}

// ↔ 방향 전환: 끊고 → 언어 교환 → 재연결
async function switchDirection() {
  const temp = state.myLang;
  state.myLang = state.partnerLang;
  state.partnerLang = temp;

  updateDirectionLabel();

  // 기존 카드 봉인 (전환 후 새 발화는 새 카드로)
  sealedTypes.add("user-transcript");
  sealedTypes.add("assistant");

  // 연결 중이면 끊고 재연결
  if (state.client) {
    const wasStreaming = state.audio.isStreaming;
    disconnect();
    await connect();
    if (wasStreaming) await toggleAudio();
  }
}

// Handle messages
function handleMessage(message) {
  updateStatus("debugInfo", `Message: ${message.type}`);

  switch (message.type) {
    case MultimodalLiveResponseType.TEXT:
      addMessage(message.data, "assistant");
      break;

    case MultimodalLiveResponseType.AUDIO:
      if (state.audio.player) {
        state.audio.player.play(message.data);
      }
      break;

    case MultimodalLiveResponseType.INPUT_TRANSCRIPTION:
      if (message.data.text) {
        console.log("Input transcription:", message.data);
        // 새 입력 시작 → 이전 번역 카드 봉인 (쌍 끊기)
        sealedTypes.add("assistant");
        // 내 음성 원문 → 오른쪽 회색 카드
        addMessage(message.data.text, "user-transcript", true);
      } else {
        // 빈 text → 카드 봉인 (다음 텍스트는 새 카드로)
        sealedTypes.add("user-transcript");
      }
      break;

    case MultimodalLiveResponseType.OUTPUT_TRANSCRIPTION:
      if (message.data.text) {
        console.log("Output transcription:", message.data);
        // 새 번역 시작 → 이전 입력 카드 봉인 (쌍 끊기)
        sealedTypes.add("user-transcript");
        // 번역된 텍스트 → 왼쪽 파란 카드
        addMessage(message.data.text, "assistant", true);
      } else {
        // 빈 text → 카드 봉인
        sealedTypes.add("assistant");
      }
      break;

    case MultimodalLiveResponseType.SETUP_COMPLETE:
      console.log("Setup complete:", message.data);
      addMessage("Ready!", "system");

      // Display the setup JSON
      if (state.client && state.client.lastSetupMessage) {
        elements.setupJsonDisplay.textContent = JSON.stringify(
          state.client.lastSetupMessage,
          null,
          2
        );
        elements.setupJsonSection.style.display = "block";
      }
      break;

    case MultimodalLiveResponseType.TOOL_CALL:
      console.log("🛠️ Tool call received: ", message.data);
      const functionCalls = message.data.functionCalls;
      const functionResponses = [];
      for (let index = 0; index < functionCalls.length; index++) {
        const functionCall = functionCalls[index];
        const functionName = functionCall.name;
        const functionCallId = functionCall.id;
        const parameters = functionCall.args;
        console.log(
          `Calling function ${functionName} with parameters: ${JSON.stringify(
            parameters
          )}`
        );
        let result;
        try {
          result = state.client.callFunction(functionName, parameters);
          functionResponses.push({
            id: functionCallId,
            name: functionName,
            response: { result: result ?? "ok" },
          });
        } catch (err) {
          console.error(`Error calling function ${functionName}:`, err);
          functionResponses.push({
            id: functionCallId,
            name: functionName,
            response: { error: err.message },
          });
        }
      }
      // Send all function responses back to the API
      state.client.sendToolResponse(functionResponses);
      break;

    case MultimodalLiveResponseType.TURN_COMPLETE:
      console.log("Turn complete:", message.data);
      updateStatus("debugInfo", "Turn complete");
      break;

    case MultimodalLiveResponseType.INTERRUPTED:
      console.log("Interrupted");
      addMessage("[Interrupted]", "system");
      if (state.audio.player) state.audio.player.interrupt();
      break;
  }
}

// Connection handlers
function handleOpen() {
  updateStatus("connectionStatus", "Connected");
}

function handleClose() {
  updateStatus("connectionStatus", "Disconnected");
  disconnect();
}

function handleError(error) {
  console.error("Error:", error);
  updateStatus("connectionStatus", "Error: " + error);
  updateStatus("debugInfo", "Error: " + error);
}

// Toggle audio
async function toggleAudio() {
  if (!state.audio.isStreaming) {
    try {
      // Initialize streamer if needed
      if (!state.audio.streamer && state.client) {
        state.audio.streamer = new AudioStreamer(state.client);
      }

      if (state.audio.streamer) {
        // Get selected microphone device ID
        const selectedMicId = elements.micSelect.value;
        await state.audio.streamer.start(selectedMicId);
        state.audio.isStreaming = true;
        elements.startAudioBtn.textContent = "Stop Audio";
        addMessage("[Microphone on]", "system");
      } else {
        addMessage("[Connect to Gemini first]", "system");
      }
    } catch (error) {
      addMessage("[Audio error: " + error.message + "]", "system");
    }
  } else {
    if (state.audio.streamer) state.audio.streamer.stop();
    state.audio.isStreaming = false;
    elements.startAudioBtn.textContent = "Start Audio";
    addMessage("[Microphone off]", "system");
  }
}

// Toggle video
async function toggleVideo() {
  if (!state.video.isStreaming) {
    try {
      // Initialize streamer if needed
      if (!state.video.streamer && state.client) {
        state.video.streamer = new VideoStreamer(state.client);
      }

      if (state.video.streamer) {
        // Get selected camera device ID
        const selectedCameraId = elements.cameraSelect.value;
        const video = await state.video.streamer.start({
          fps: 1,
          width: 640,
          height: 480,
          deviceId: selectedCameraId || null,
        });
        state.video.isStreaming = true;

        elements.videoPreview.srcObject = video.srcObject;
        elements.videoPreview.hidden = false;
        elements.startVideoBtn.textContent = "Stop Video";
        addMessage("[Camera on]", "system");
      } else {
        addMessage("[Connect to Gemini first]", "system");
      }
    } catch (error) {
      addMessage("[Video error: " + error.message + "]", "system");
    }
  } else {
    if (state.video.streamer) state.video.streamer.stop();
    state.video.isStreaming = false;

    elements.videoPreview.srcObject = null;
    elements.videoPreview.hidden = true;
    elements.startVideoBtn.textContent = "Start Video";
    addMessage("[Camera off]", "system");
  }
}

// Toggle screen
async function toggleScreen() {
  if (!state.screen.isSharing) {
    try {
      // Initialize capture if needed
      if (!state.screen.capture && state.client) {
        state.screen.capture = new ScreenCapture(state.client);
      }

      if (state.screen.capture) {
        const video = await state.screen.capture.start({ fps: 0.5 });
        state.screen.isSharing = true;

        // Show screen preview in the same video element
        elements.videoPreview.srcObject = video.srcObject;
        elements.videoPreview.hidden = false;
        elements.startScreenBtn.textContent = "Stop Sharing";
        addMessage("[Screen sharing on]", "system");
      } else {
        addMessage("[Connect to Gemini first]", "system");
      }
    } catch (error) {
      addMessage("[Screen share error: " + error.message + "]", "system");
    }
  } else {
    if (state.screen.capture) state.screen.capture.stop();
    state.screen.isSharing = false;

    // Hide preview if not using camera
    if (!state.video.isStreaming) {
      elements.videoPreview.srcObject = null;
      elements.videoPreview.hidden = true;
    }

    elements.startScreenBtn.textContent = "Share Screen";
    addMessage("[Screen sharing off]", "system");
  }
}

// Send message
function sendMessage() {
  const message = elements.chatInput.value.trim();
  if (!message) return;

  if (state.client) {
    addMessage(message, "user");
    state.client.sendTextMessage(message);
    elements.chatInput.value = "";
  } else {
    addMessage("[Connect to Gemini first]", "system");
  }
}

// Add message to chat (봉인 로직 포함)
function addMessage(text, type, append = false) {
  const messages = elements.chatContainer.querySelectorAll("div." + type);
  const lastMessage = messages[messages.length - 1];

  if (append && lastMessage && !sealedTypes.has(type)) {
    // 미봉인 → 기존 카드에 이어붙임
    lastMessage.textContent += text;
  } else {
    // 봉인됨 또는 첫 카드 → 새 카드 생성
    const message = createMessage(text, type);
    elements.chatContainer.appendChild(message);
    sealedTypes.delete(type);
  }

  elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
}

// Update volume
function updateVolume() {
  const value = elements.volume.value;
  const volume = value / 100;
  if (state.audio.player) {
    state.audio.player.setVolume(volume);
  }
  updateStatus("volumeValue", value + "%");
}

// Update temperature display
function updateTemperature() {
  const value = elements.temperature.value;
  updateStatus("temperatureValue", value);
}

// Event listeners
function initEventListeners() {
  elements.connectBtn.addEventListener("click", connect);
  elements.disconnectBtn.addEventListener("click", disconnect);
  elements.startAudioBtn.addEventListener("click", toggleAudio);
  elements.startVideoBtn.addEventListener("click", toggleVideo);
  elements.startScreenBtn.addEventListener("click", toggleScreen);
  elements.sendBtn.addEventListener("click", sendMessage);
  elements.volume.addEventListener("input", updateVolume);
  elements.temperature.addEventListener("input", updateTemperature);

  if (elements.switchBtn) {
    elements.switchBtn.addEventListener("click", switchDirection);
  }

  elements.chatInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendMessage();
  });
}

// Initialize
window.addEventListener("DOMContentLoaded", () => {
  initDOM();
  initEventListeners();
  populateMediaDevices();
  updateDirectionLabel();
  updateStatus("debugInfo", "Application initialized");
});
