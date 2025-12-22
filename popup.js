// popup.js

(async () => {
    const slider = document.getElementById("sliderInput");
    const sliderValue = document.getElementById("sliderValue");
    const pitchSlider = document.getElementById("pitchSlider");
    const pitchValue = document.getElementById("pitchValue");
    const voiceSelect = document.getElementById("voiceSelect");
    const navModeSelect = document.getElementById("navModeSelect");
    const highlightColorInput = document.getElementById("highlightColorInput");
    const highlightTransparencyInput = document.getElementById("highlightTransparencyInput");
    const highlightTransparencyValue = document.getElementById("highlightTransparencyValue");
    
    const wordHighlightColorInput = document.getElementById("wordHighlightColorInput");
    const wordHighlightTransparencyInput = document.getElementById("wordHighlightTransparencyInput");
    const wordHighlightTransparencyValue = document.getElementById("wordHighlightTransparencyValue");
    
    // Reading Area Buttons
    const btnEditReadingArea = document.getElementById("btnEditReadingArea");
    const btnSaveReadingArea = document.getElementById("btnSaveReadingArea");

    const STORAGE_DEFAULTS = {
        rate: "1.0",
        pitch: "1.0",
        voice: "", 
        navigationMode: "block",
        highlightColor: "#add8e6",
        highlightTransparency: 25,
        wordHighlightColor: "#ffff00",
        wordHighlightTransparency: 100,
        readingAreaTop: 20,
        readingAreaBottom: 80
    };

    async function loadSettings() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(STORAGE_DEFAULTS, (items) => {
                resolve(items);
            });
        });
    }

    async function saveSetting(key, value) {
        await chrome.storage.sync.set({ [key]: value });
    }
    
    const contentWrapper = document.getElementById('content-wrapper');
    const sendResizeMessage = () => {
        const requiredHeight = contentWrapper.scrollHeight;
        const requiredWidth = contentWrapper.scrollWidth;

        window.parent.postMessage({
            type: 'resize-voice-options-panel',
            height: requiredHeight,
            width: requiredWidth
        }, '*'); 
    };

    const tabButtons = document.querySelectorAll('.tab-button');
    const tabPanes = document.querySelectorAll('.tab-pane');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabPanes.forEach(pane => pane.classList.remove('active'));

            const tabId = button.dataset.tab;
            button.classList.add('active');
            document.getElementById(tabId).classList.add('active');

            sendResizeMessage();
        });
    });

    function populateVoices(selectedVoice) {
        chrome.tts.getVoices((voices) => {
            voiceSelect.innerHTML = "";
            voices.forEach(v => {
                const option = document.createElement("option");
                option.value = v.voiceName;
                option.textContent = v.voiceName + (v.lang ? ` (${v.lang})` : '');
                voiceSelect.appendChild(option);
            });
            if (selectedVoice) {
                const exists = voices.some(v => v.voiceName === selectedVoice);
                if (exists) voiceSelect.value = selectedVoice;
            }
        });
    }

    const settings = await loadSettings();
    
    slider.value = settings.rate;
    sliderValue.textContent = settings.rate;

    pitchSlider.value = settings.pitch;
    pitchValue.textContent = settings.pitch;

    populateVoices(settings.voice);

    navModeSelect.value = settings.navigationMode;
    highlightColorInput.value = settings.highlightColor;
    highlightTransparencyInput.value = settings.highlightTransparency;
    highlightTransparencyValue.textContent = `${settings.highlightTransparency}%`;

    wordHighlightColorInput.value = settings.wordHighlightColor;
    wordHighlightTransparencyInput.value = settings.wordHighlightTransparency;
    wordHighlightTransparencyValue.textContent = `${settings.wordHighlightTransparency}%`;

    slider.addEventListener("input", async () => {
        const val = slider.value;
        sliderValue.textContent = val;
        await saveSetting("rate", val);
    });

    pitchSlider.addEventListener("input", async () => {
        const val = pitchSlider.value;
        pitchValue.textContent = val;
        await saveSetting("pitch", val);
    });

    voiceSelect.addEventListener("change", async () => {
        const v = voiceSelect.value;
        await saveSetting("voice", v);
    });

    navModeSelect.addEventListener("change", async () => {
        const mode = navModeSelect.value;
        await saveSetting("navigationMode", mode);
    });

    highlightColorInput.addEventListener("input", async () => {
        const color = highlightColorInput.value;
        await saveSetting("highlightColor", color);
    });

    highlightTransparencyInput.addEventListener("input", async () => {
        const transparency = highlightTransparencyInput.value;
        highlightTransparencyValue.textContent = `${transparency}%`;
        await saveSetting("highlightTransparency", parseInt(transparency, 10));
    });

    wordHighlightColorInput.addEventListener("input", async () => {
        const color = wordHighlightColorInput.value;
        await saveSetting("wordHighlightColor", color);
    });

    wordHighlightTransparencyInput.addEventListener("input", async () => {
        const transparency = wordHighlightTransparencyInput.value;
        wordHighlightTransparencyValue.textContent = `${transparency}%`;
        await saveSetting("wordHighlightTransparency", parseInt(transparency, 10));
    });

    // Reading Area Logic
    btnEditReadingArea.addEventListener("click", () => {
        // Send message to active tab
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { action: "enableReadingAreaEditor" });
            }
        });
        btnEditReadingArea.style.display = "none";
        btnSaveReadingArea.style.display = "inline-block";
    });

    btnSaveReadingArea.addEventListener("click", () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { action: "saveReadingAreaEditor" });
            }
        });
        btnSaveReadingArea.style.display = "none";
        btnEditReadingArea.style.display = "inline-block";
    });

    const resizeObserver = new ResizeObserver(sendResizeMessage);
    resizeObserver.observe(document.body);
    sendResizeMessage();
})();