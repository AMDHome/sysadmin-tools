function componentToHex(c) {
    const hex = c.toString(16);
    return hex.length == 1 ? "0" + hex : hex;
}

function rgbToHex(r, g, b, a = null) {
    let hex = "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
    if (a !== null) {
        hex += componentToHex(a);
    }
    return hex.toUpperCase();
}

function hexToRGB(hex) {
    hex = hex.replace(/^#/, "");
    if (hex.length === 3) {
        hex = hex.split('').map(c => c + c).join('');
    }

    const r = parseInt(hex.slice(0,2), 16);
    const g = parseInt(hex.slice(2,4), 16);
    const b = parseInt(hex.slice(4,6), 16);
    const a = (hex.length === 8) ? parseInt(hex.slice(6, 8), 16) / 255 : 1;

    return {r, g, b, a};
}

function calculateLowerBounds(base, target) {
    let bounds = [0];

    function calcChannel(baseC, targetC) {
        bounds.push((targetC - baseC) / (0 - baseC));
        bounds.push((targetC - baseC) / (255 - baseC));
    }

    calcChannel(base.r, target.r);
    calcChannel(base.g, target.g);
    calcChannel(base.b, target.b);

    return Math.max(...bounds.filter(Number.isFinite));
}

function normalizeAlpha(alpha) {
    
    const parts = alpha.split('.');
    if (parts.length > 2) alpha = parts[0] + '.' + parts.slice(1).join('');

    // Normalize Alpha to Decimal
    if (alpha === '' || alpha === '1') {
        alpha = 1;
    } else if (alpha.includes('.')) {
        const parsed = parseFloat(alpha);
        alpha = Math.min(Math.max(isNaN(parsed) ? 0 : parsed, 0), 1);
    } else {
        const parsed = parseInt(alpha, 16);
        alpha = Math.min(Math.max(isNaN(parsed) ? 0 : parsed / 255, 0), 1);
    }

    return alpha;
}

function findOverlay() {
    const base = hexToRGB(document.getElementById('baseColor').value);
    const target = hexToRGB(document.getElementById('desiredColor').value);
    const targetAlpha = document.getElementById('targetA');
    const alpha = normalizeAlpha(targetAlpha.value);

    const lowerBound = calculateLowerBounds(base, target);
    targetAlpha.title = "Alpha must be between " + Math.round(lowerBound * 10000) / 10000 + 
                        " (" + componentToHex(Math.ceil(lowerBound * 255)).toUpperCase() + 
                        ") and 1 (FF) for this color pair";

    if (alpha < lowerBound) {
        const errorBox = document.getElementById('errorMessage')
        errorBox.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Warning:<br>Alpha must be between ' +
                              Math.round(lowerBound * 10000) / 10000 + " (" + 
                              componentToHex(Math.ceil(lowerBound * 255)).toUpperCase() + 
                              ") - 1 (FF) for this base and target color pair.";
        document.getElementById('errorMessage').classList.remove('hiddenError');
        document.getElementById('outputColorOverlay').classList.add('invalidResultBackground');
        document.getElementById('hexOutput').classList.add('invalidResult');
        document.getElementById('RGBAOutput').classList.add('invalidResult');
        return;
    } else {
        document.getElementById('errorMessage').classList.add('hiddenError');
        document.getElementById('outputColorOverlay').classList.remove('invalidResultBackground');
        document.getElementById('hexOutput').classList.remove('invalidResult');
        document.getElementById('RGBAOutput').classList.remove('invalidResult');
    }

    const r = Math.round((target.r - base.r * (1 - alpha)) / alpha);
    const g = Math.round((target.g - base.g * (1 - alpha)) / alpha);
    const b = Math.round((target.b - base.b * (1 - alpha)) / alpha);

    const overlay = rgbToHex(r, g, b, Math.round(alpha * 255));

    document.getElementById('outputColorPreview').style.background = overlay;
    document.getElementById('outputColorTextBox').style.background = overlay;

    // Set Text
    const hexText = document.getElementById("hexOutput");
    const rgbaText = document.getElementById("RGBAOutput") ;
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    if (brightness > 128) {
        // Light background → make text background dark
        document.getElementById("outputColorOverlay").style.backgroundColor = "rgba(0, 0, 0, 0.45)";
        hexText.style.color = "#f0f0f0";
        rgbaText.style.color = "#f0f0f0";
    } else {
        // Dark background → make text background light
        document.getElementById("outputColorOverlay").style.backgroundColor = "rgba(255, 255, 255, 0.6)";
        hexText.style.color = "black";
        rgbaText.style.color = "black";
    }
    document.getElementById("hexOutputText").textContent = `${overlay}`;
    document.getElementById("RGBAOutputText").textContent = `rgb(${r}, ${g}, ${b}, ${Math.round(alpha * 10000) / 10000})`;
}


function blendColors() {
    const base = hexToRGB(document.getElementById('baseColor').value);
    const overlay = hexToRGB(document.getElementById('overlayColor').value);

    const r = Math.round(overlay.r * overlay.a + base.r * (1 - overlay.a));
    const g = Math.round(overlay.g * overlay.a + base.g * (1 - overlay.a));
    const b = Math.round(overlay.b * overlay.a + base.b * (1 - overlay.a));

    const blendedHex = rgbToHex(r, g, b);

    document.getElementById('outputColorPreview').style.background = blendedHex;
    document.getElementById('outputColorTextBox').style.background = blendedHex;

    // Set Text
    const hexText = document.getElementById("hexOutput");
    const rgbaText = document.getElementById("RGBAOutput");
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    if (brightness > 128) {
        // Light background → make text background dark
        document.getElementById("outputColorOverlay").style.backgroundColor = "rgba(0, 0, 0, 0.45)";
        hexText.style.color = "#f0f0f0";
        rgbaText.style.color = "#f0f0f0";
    } else {
        // Dark background → make text background light
        document.getElementById("outputColorOverlay").style.backgroundColor = "rgba(255, 255, 255, 0.6)";
        hexText.style.color = "black";
        rgbaText.style.color = "black";
    }
    document.getElementById("hexOutputText").textContent = `${blendedHex}`;
    document.getElementById("RGBAOutputText").textContent = `rgb(${r}, ${g}, ${b})`;
}


// Update HEX when RGB changes
function updateHexFromRgb(prefix) {
    const r = parseInt(document.getElementById(prefix + "R").value) || 0;
    const g = parseInt(document.getElementById(prefix + "G").value) || 0;
    const b = parseInt(document.getElementById(prefix + "B").value) || 0;
    const aInput = document.getElementById(prefix + "A");
    let a = null;
    if (aInput) {
        let aFloat = parseFloat(aInput.value);
        if (isNaN(aFloat)) {
            aFloat = 1.0; // Default to fully opaque if invalid/missing
        }
        a = Math.round(aFloat * 255);
    }

    const hexInput = document.getElementById(prefix + "Color");
    hexInput.value = rgbToHex(r, g, b, a);

    const preview = document.getElementById(prefix + "Preview");
    preview.style.background = hexInput.value;
    
    if (document.getElementById('outputCalc').classList.contains('active')) {
        blendColors();
    } else {
        findOverlay()
    }
}


// Update RGB when HEX changes
function updateRgbFromHex(prefix) {
    const hexInput = document.getElementById(prefix + "Color");
    const hex = hexInput.value.trim();
    const rgb = hexToRGB(hex);
    if (!rgb) return;

    document.getElementById(prefix + "R").value = rgb.r;
    document.getElementById(prefix + "G").value = rgb.g;
    document.getElementById(prefix + "B").value = rgb.b;
    const aInput = document.getElementById(prefix + "A");
    if (aInput) {
        const alpha = rgb.a !== null ? rgb.a : 1.0;
        aInput.value = alpha.toFixed(2);
    }

    const preview = document.getElementById(prefix + "Preview");
    preview.style.background = hex;

    if (document.getElementById('outputCalc').classList.contains('active')) {
        blendColors();
    } else {
        findOverlay()
    }
}

// Attach listeners
function attachListeners(prefix) {
    ["R", "G", "B"].forEach(channel => {
        const input = document.getElementById(prefix + channel);
        if (input) {
            input.addEventListener("input", () => {
                input.value = Math.min(255, parseInt(input.value.replace(/\D/g, '') || '0', 10));
                updateHexFromRgb(prefix);
            });
        }
    });

    const hexInput = document.getElementById(prefix + "Color");
    hexInput.addEventListener("input", () => updateRgbFromHex(prefix));
}

function initColors() {
    document.getElementById("overlayR").value = Math.floor(Math.random() * 256); // 0-255
    document.getElementById("overlayG").value = Math.floor(Math.random() * 256); // 0-255
    document.getElementById("overlayB").value = Math.floor(Math.random() * 256); // 0-255
    document.getElementById("overlayA").value = (Math.random()).toFixed(2);      // 0.00-1.00 (2 decimals)
    updateHexFromRgb("overlay"); // Update overlayColor hex field too!

    // Fill in target color with the results from the output calculator
    document.getElementById("desiredColor").value = document.getElementById("hexOutputText").innerText;
    updateRgbFromHex("desired");

    // Randomize Target
    document.getElementById("targetA").value = document.getElementById("overlayA").value;
}

function sanitizeTargetAlpha(input) {
    const inputValue = input.value;
    const inputCursor = input.selectionStart;
    
    let sanitizedValue = '';
    let hasDecimal = false;
    
    for (let i = 0; i < inputValue.length; i++) {
        let char = inputValue[i];

        if (sanitizedValue.length === 2 && !sanitizedValue.includes('.')) {
            input.value = sanitizedValue;
            return;
        }
    
        // Allow letters only if input does not have a decimal, is less than 2
        if (/[a-fA-F]/.test(char)) {
            if (i < 2 && !hasDecimal) {
                sanitizedValue += char;
            }
        } else if (/[0-9]/.test(char)) {
            sanitizedValue += char;
        } else if (char === '.') {
            if (!hasDecimal) {
                if (i === 0 || (i === 1 && sanitizedValue[0] === '0')) {
                    sanitizedValue += char;
                    hasDecimal = true;
                }
            }
        }
    }
    
      input.value = sanitizedValue;

    if (inputValue !== sanitizedValue) {
        const diff = inputValue.length - sanitizedValue.length;
        input.value = sanitizedValue;
        input.setSelectionRange(inputCursor - diff, inputCursor - diff);
    }

    if (sanitizedValue[0] === "0" || sanitizedValue[0] === "1" || sanitizedValue.length > 1) {
        findOverlay();
    }
}

function showCopyMessage(id) {
    const copyMsg = document.getElementById(id);
    copyMsg.classList.add('showCopied');
    setTimeout(() => {
        copyMsg.classList.remove('showCopied');
    }, 1500); // show for 1.5 seconds
}

// Initialize
document.addEventListener("DOMContentLoaded", () => {
    attachListeners("base");
    attachListeners("overlay");
    attachListeners("desired");
    initColors();

    const overlayA = document.getElementById("overlayA")
    overlayA.addEventListener("input", () => {
        let val = overlayA.value.replace(/[^0-9.]/g, '');
        if (val === '0') { updateHexFromRgb("overlay"); return; }

        const parts = val.split('.');
        if (parts.length > 2) val = parts[0] + '.' + parts.slice(1).join('');

        let num = parseFloat(val);
        overlayA.value = isNaN(num) ? '' : Math.min(Math.max(num, 0), 1);

        updateHexFromRgb("overlay");
    });

    document.getElementById("basePreview").style.background = document.getElementById("baseColor").value;
    blendColors();

    const showBaseButton = document.getElementById("showBaseButton");
    const outputButton = document.getElementById('outputCalc');
    const overlayButton = document.getElementById('overlayCalc');
    const desiredControls = document.getElementById('desired');
    const targetAlpha = document.getElementById('targetAInput');
    const targetAlphaInput = document.getElementById('targetA');
    const overlayControls = document.getElementById('overlay');
    const outputHelp = document.getElementById('output-help');
    const overlayHelp = document.getElementById('overlay-help');

    targetAlphaInput.addEventListener('input', (event) => {
        sanitizeTargetAlpha(event.target);
    });

    showBaseButton.addEventListener("click", () => {
        showBaseButton.classList.toggle("active");
        document.getElementById("baseColorPreview").classList.toggle("hiddenBasePreview");

        const isActive = showBaseButton.classList.contains("active");
        showBaseButton.textContent = isActive ? "Hide Base" : "Show Base";
    });

    outputButton.addEventListener('click', () => {
        outputButton.classList.add('active');
        overlayButton.classList.remove('active');
        desiredControls.classList.add('hidden');
        overlayControls.classList.remove('hidden');
        showBaseButton.classList.remove('hidden');
        targetAlpha.classList.add('hidden');
        outputHelp.classList.remove('hidden');
        overlayHelp.classList.add('hidden');
        document.getElementById('errorMessage').classList.add('hiddenError');
        document.getElementById('outputColorOverlay').classList.remove('invalidResultBackground');
        document.getElementById('hexOutput').classList.remove('invalidResult');
        document.getElementById('RGBAOutput').classList.remove('invalidResult');
        blendColors();
    });
    
    overlayButton.addEventListener('click', () => {
        overlayButton.classList.add('active');
        outputButton.classList.remove('active');
        desiredControls.classList.remove('hidden');
        overlayControls.classList.add('hidden');
        showBaseButton.classList.add('hidden');
        targetAlpha.classList.remove('hidden');
        outputHelp.classList.add('hidden');
        overlayHelp.classList.remove('hidden');

        // Reset base color preview
        document.getElementById("baseColorPreview").classList.add("hiddenBasePreview");
        showBaseButton.classList.remove("active");
        showBaseButton.textContent = "Show Base";
        findOverlay();
    });

    document.getElementById('hexOutputText').addEventListener('click', () => {
        const text = document.getElementById('hexOutputText').innerText;
        navigator.clipboard.writeText(text).then(() => {
            showCopyMessage('hexOutputCopied');
        }).catch(err => {
            console.error('Failed to copy:', err);
        });
    });
    
    document.getElementById('RGBAOutputText').addEventListener('click', () => {
        const text = document.getElementById('RGBAOutputText').innerText;
        navigator.clipboard.writeText(text).then(() => {
            showCopyMessage('RGBAOutputCopied');
        }).catch(err => {
            console.error('Failed to copy:', err);
        });
    });
});
