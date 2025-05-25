import { patienceDiff } from './patienceDiff.js';
import { setDiffEffect, rightDiffPlugin, leftDiffPlugin, toggleLineWrapping } from './codemirror.js';
import { compareTwoStrings } from "https://cdn.jsdelivr.net/npm/string-similarity@4.0.4/+esm";

function findMaxScore(matrix, highThreshold = 0.6, minThreshold = 0.3) {
    const rows = matrix.length;
    const cols = matrix[0].length;

    let dp = new Map(); // key: lastCol (or null), value: [sum, highCount, path]

    // First row: allow selecting any col or skipping
    dp.set(null, [0, 0, [null]]);
    for (let col = 0; col < cols; col++) {
        const rawVal = matrix[0][col];
        const val = rawVal < minThreshold ? 0 : rawVal;
        dp.set(col, [val, val >= highThreshold ? 1 : 0, [col]]);
    }

    for (let row = 1; row < rows; row++) {
        const newDp = new Map();

        for (let col = 0; col < cols; col++) {
            const rawVal = matrix[row][col];
            const val = rawVal < minThreshold ? 0 : rawVal;

            let best = null;

            for (const [prevCol, [sum, highCount, path]] of dp.entries()) {
                if (prevCol === null || prevCol < col) {
                    const newSum = sum + val;
                    const newHigh = highCount + (val >= highThreshold ? 1 : 0);
                    const newPath = [...path, col];

                    if (
                        !best ||
                        newSum > best[0] ||
                        (newSum === best[0] && newHigh > best[1])
                    ) {
                        best = [newSum, newHigh, newPath];
                    }
                }
            }

            if (best) newDp.set(col, best);
        }

        // Also consider skipping this row
        for (const [prevCol, [sum, highCount, path]] of dp.entries()) {
            const newPath = [...path, null];
            if (!newDp.has(prevCol) || newDp.get(prevCol)[0] < sum) {
                newDp.set(prevCol, [sum, highCount, newPath]);
            }
        }

        dp = newDp;
    }

    // Final result with rounding for fairness
    let bestOverall = null;
    for (const result of dp.values()) {
        const [sum, highCount, path] = result;
        const roundedSum = Math.round(sum * 1e5) / 1e5;

        if (
            !bestOverall ||
            roundedSum > bestOverall[0] ||
            (roundedSum === bestOverall[0] && highCount > bestOverall[1])
        ) {
            bestOverall = [roundedSum, highCount, path];
        }
    }

    return bestOverall ? bestOverall[2] : [];
}



function balanceBlock(removedLines, insertedLines, removedIndex, insertedIndex) {
    const balanced = [];
    const scores = [];

    // Attempt to pair each removed lines
    removedLines.forEach((lineA, indexA) => {
        let lineScore = [];
        for (let i = 0; i < insertedLines.length; i++) {
            lineScore.push(compareTwoStrings(lineA.trim(), insertedLines[i].trim()));
        }

        scores.push(lineScore)
    });

    const result = findMaxScore(scores);
    function nextNonNullPair(a) {
        for (; a < result.length; a++) {
            if (result[a] !== null) return a;
        }
        return -1;
    }
    
    let lastA = -1
    let nextB = 0;
    for (let i = 0; i < result.length; i++) {
        if (result[i] === null) {
            const nnIdx = nextNonNullPair(i);

            if (nnIdx == -1) {
                for (; i < result.length; i++) {
                    balanced.push({ aIndex: i + removedIndex, bIndex: -1, status: 'removed',
                                    lineA: removedLines[i], lineB: "" });
                }
            } else {
                for (; i < nnIdx; i++) {
                    if (nextB == result[nnIdx]) {
                        balanced.push({ aIndex: i + removedIndex, bIndex: -1, status: 'removed',
                                        lineA: removedLines[i], lineB: "" });
                    } else {
                        balanced.push({ aIndex: i + removedIndex, bIndex: nextB + insertedIndex, status: 'cont',
                                        lineA: removedLines[i], lineB: insertedLines[nextB] });
                        nextB++;
                    }
                }
                i--;
            }
        } else {
            if (nextB < result[i]) {
                for (; nextB < result[i]; nextB++) {
                    balanced.push({ aIndex: -1, bIndex: nextB + insertedIndex, status: 'inserted',
                                    lineA: "", lineB: insertedLines[nextB] });
                }
            }

            if (nextB == result[i]) {
                balanced.push({ aIndex: i + removedIndex, bIndex: nextB + insertedIndex, 
                                status: removedLines[i] === insertedLines[nextB] ? 'identical' : 'changed',
                                lineA: removedLines[i], lineB: insertedLines[nextB] });
                nextB++;
            }
        }
    }

    for (; nextB < insertedLines.length; nextB++) {
        balanced.push({ aIndex: -1, bIndex: nextB + insertedIndex, status: 'inserted', 
                        lineA: "", lineB: insertedLines[nextB]});
    }

    return balanced;
}

function balancePatienceOutput(lines) {
    const rebalanced = [];
    let i = 0;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].aIndex >= 0 && lines[i].bIndex >= 0) {
            rebalanced.push({ aIndex: lines[i].aIndex, bIndex: lines[i].bIndex, status: 'identical',
                              lineA: lines[i].line, lineB: lines[i].line });
            continue;

        // When we encounter a Removed Block
        } else if (lines[i].aIndex >= 0 && lines[i].bIndex < 0) {
            const removed = [];
            const inserted = [];
            let insertInit = -1;
            let blockEnd = -1;
            
            // Find full block of removed/inserted, and run similarity test on that block
            for (blockEnd = i; blockEnd < lines.length; blockEnd++) {
                if (insertInit === -1 && lines[blockEnd].aIndex >= 0 && lines[blockEnd].bIndex < 0) {
                    removed.push(lines[blockEnd].line);
                } else if (lines[blockEnd].aIndex < 0 && lines[blockEnd].bIndex >= 0) {
                    if (insertInit === -1) insertInit = blockEnd;
                    inserted.push(lines[blockEnd].line)
                } else {
                    break;
                }
            }

            // if only removed then push removed lines into rebalanced
            if (insertInit === -1) {
                for (let k = i; k < blockEnd; k++) {
                    rebalanced.push({ aIndex: lines[k].aIndex, bIndex: lines[k].bIndex, status: 'removed', 
                                      lineA: lines[k].line, lineB: '' });
                }

            // else run diff and push that instead
            } else {
                rebalanced.push(...balanceBlock(removed, inserted, lines[i].aIndex, lines[insertInit].bIndex));
            }

            i = blockEnd - 1;

        // We have encountered an insertion block
        } else if (lines[i].aIndex < 0 && lines[i].bIndex >= 0) {
            rebalanced.push({ aIndex: -1, bIndex: lines[i].bIndex, status: 'inserted', 
                              lineA: '', lineB: lines[i].line });
        }
    }
    return rebalanced;
}


function print(result) {
    var diffLines = "";
    result.forEach((o) => {
      if (o.bIndex < 0 && o.moved) {
        diffLines += "-m  ";
      } else if (o.moved) {
        diffLines += "+m  ";
      } else if (o.aIndex < 0) {
        diffLines += "+   ";
      } else if (o.bIndex < 0) {
        diffLines += "-   ";
      } else {
        diffLines += "    ";
      }
      diffLines += o.line + "\n";
    });

    console.log(result);
    console.log(diffLines);
}

function buildBalancedDocs(diffLines) {
    const left = [], right = [];
    for (const entry of diffLines) {
        left.push(entry.lineA ?? "");
        right.push(entry.lineB ?? "");
    }
    return {
        leftDoc: left.join('\n'),
        rightDoc: right.join('\n')
    };
}

function unBalanceDocs(editor, decoPlugin) {
    const decorations = editor.plugin(decoPlugin).decorations;
    const doc = editor.state.doc;

    if (!decorations) return;

    const toExclude = new Set();
    const dirtyLines = new Set();

    // Find all padding lines
    decorations.between(0, doc.length, (from, to, deco) => {
        const line = doc.lineAt(from).number;
        if (deco.spec.class === "line-padding" && !dirtyLines.has(line)) {
            toExclude.add(line);
        }

        if (deco.spec.class === "line-dirty") {
            dirtyLines.add(line);
            toExclude.delete(line);
        }
    });

    // Filter out all line-padding
    const textLines = [];
    for (let i = 1; i <= doc.lines; i++) {
        if (!toExclude.has(i)) {
            textLines.push(doc.line(i).text);
        }
    }

    return textLines;
}

function compareIPv4(a, b) {
    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);
    for (let i = 0; i < 4; i++) {
        const diff = aParts[i] - bParts[i];
        if (diff !== 0) return diff;
    }
    return 0;
}

function compareIP(a, b) {
    const aIsV4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(a);
    const bIsV4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(b);

    if (aIsV4 && bIsV4) return compareIPv4(a, b);
    if (aIsV4) return -1; // v4 before everything else
    if (bIsV4) return 1;
    return a.localeCompare(b); // fallback for v6/text
}


function showCheckMark(buttonId) {
    const buttonText = Array.from(document.getElementById(buttonId).children);
    
    buttonText.forEach(text => text.classList.toggle('hidden-zoom'));
    setTimeout(() => {
        buttonText.forEach(text => text.classList.toggle('hidden-zoom'));
    }, 1000);
}


// Set diffDeco to null to clear decorations
// Set diffDeco to false to make keep existing decorations
// Set diffDeco to a diff array to reset decorations
function setEditorContent(leftText = null, rightText = null, diffDeco = false) {
    // Set text content
    if (leftText !== null) {
        window.leftEditor.dispatch({
            changes: { from: 0, to: window.leftEditor.state.doc.length, insert: leftText }
        });
    }
    
    if(rightText !== null) {
        window.rightEditor.dispatch({
            changes: { from: 0, to: window.rightEditor.state.doc.length, insert: rightText }
        });
    }

    // Then apply diff decorations
    if (diffDeco !== false) {
        window.leftEditor.dispatch({ effects: setDiffEffect.of({ diffResult: diffDeco }) });
        window.rightEditor.dispatch({ effects: setDiffEffect.of({ diffResult: diffDeco }) });
    }
}

// Manipulates text in place. Lines stay in the same place.
// Decoration stays valid
function manipulateText(action = null, editor) {
    const doc = editor.state.doc;
    const changes = [];

    if (!action) return;

    for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        let modified = doc.line(i);

        if (action === "lowercase") {
            modified = line.text.toLowerCase();
        } else if (action === "trim") {
            modified = line.text.trim();
        }

        if (modified !== line.text) {
            changes.push({
                from: line.from,
                to: line.to,
                insert: modified
            });
        }
    }

    if (changes.length > 0) {
        editor.dispatch({ changes });
    }
}

// Manipulate text and removes decoration. Lines will change locations.
function recompileText(action = null, editor, diffPlugin) {
    const text = unBalanceDocs(editor, diffPlugin);
    let output = ""

    switch (action) {
        case "removeBlank":
            output = text.filter(line => line.trim() !== "").join('\n'); break;

        case "concat":
            output = text.join(" "); break;

        case "sortAlpha":
            output = text.sort().join('\n'); break;

        case "sortNum":
            output = text.sort((a, b) => {
                const na = parseFloat(a), nb = parseFloat(b);
                const aNum = !isNaN(na), bNum = !isNaN(nb);
                if (aNum && bNum) return na - nb;
                if (aNum) return -1;
                if (bNum) return 1;
                return a.localeCompare(b);
            }).join('\n'); break;

        case "sortIP":
            output = text.sort(compareIP).join('\n'); break;

        case "uniq":
            output = text.filter((line, i, arr) => i === 0 || line !== arr[i - 1]).join('\n'); break;
    }

    editor.dispatch({ 
        changes: { from: 0, to: editor.state.doc.length, insert: output }
    });
}

function setupCopyButton(id, editor, plugin) {
    document.getElementById(id).addEventListener("click", () => {
        const text = unBalanceDocs(editor, plugin).join("\n");
        navigator.clipboard.writeText(text).then(() => {
            showCheckMark(id);
        }).catch(err => {
            console.error(`Failed to copy from ${id}:`, err);
        });
    });
}

let leftFile = "";
let rightFile = "";
function loadFile(e, button) {
    if (button === "left-upload") {
        leftFile = e.target.result;
        setEditorContent(leftFile, null);
        document.getElementById("left-reload").classList.remove("hiddenX");
    } else if (button === "right-upload") {
        rightFile = e.target.result;
        setEditorContent(null, rightFile);
        document.getElementById("right-reload").classList.remove("hiddenX");
    }
    requestAnimationFrame(() => {
        document.getElementById("sidebar-reload").classList.remove("hiddenY");
    });
}

function reloadFile(side = null) {
    if (side === "left") {
        setEditorContent(leftFile, null);
    } else if (side === "right") {
        setEditorContent(null, rightFile);
    } else {
        setEditorContent(leftFile, rightFile);
    }
}

function clearFile(side = null) {
    if (side === "left") {
        leftFile = "";
        setEditorContent(leftFile, null);
        document.getElementById("left-reload").classList.add("hiddenX");
    } else if (side === "right") {
        rightFile = "";
        setEditorContent(null, rightFile);
        document.getElementById("right-reload").classList.add("hiddenX");
    } else {
        leftFile = "";
        rightFile = "";
        setEditorContent(leftFile, rightFile, null);
        document.getElementById("left-reload").classList.add("hiddenX");
        document.getElementById("right-reload").classList.add("hiddenX");
        document.getElementById("left-count").classList.add("hidden-dn");
        document.getElementById("right-count").classList.add("hidden-dn");
    }

    if (leftFile === "" && rightFile === "") {
        requestAnimationFrame(() => {
            document.getElementById("sidebar-reload").classList.add("hiddenY");
        });
    }
}

function setupDropZone(dropZoneId, button) {
    const zone = document.getElementById(dropZoneId);

    zone.addEventListener("dragover", (e) => {
        e.preventDefault();
        zone.firstElementChild.classList.add("active");
    });

    zone.addEventListener("dragleave", () => {
        zone.firstElementChild.classList.remove("active");
    });

    zone.addEventListener("drop", (event) => {
        event.preventDefault();
        zone.firstElementChild.classList.remove("active");

        const file = event.dataTransfer.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (e) { loadFile(e, button); };
        reader.readAsText(file);
    });
}

function updateUpVisibility() {
    const editors = document.getElementById('editor-inner');
    document.getElementById('up').classList.toggle('hidden-up', editors.scrollHeight <= editors.clientHeight);
}

document.addEventListener("DOMContentLoaded", () => {
    const rightNav = document.querySelector('.rightNav');
    if (rightNav) {
        const buttonBox = document.createElement('div');
        buttonBox.className = 'button-box';
        buttonBox.innerHTML = `
            <button class="run-diff" type="button">
                <span>Run Diff</span>
                <span class="material-symbols-outlined icons26 stretched">arrow_right</span>
            </button>
        `;
    
        rightNav.insertBefore(buttonBox, rightNav.firstChild);
    }

    document.querySelectorAll('.run-diff').forEach(button => {
        button.addEventListener('click', () => {
            const text1 = unBalanceDocs(window.leftEditor, leftDiffPlugin);
            const text2 = unBalanceDocs(window.rightEditor, rightDiffPlugin);

            // Add padded text into both editors to make the diff side by side
            const result = balancePatienceOutput(patienceDiff(text1, text2).lines);
            const { leftDoc, rightDoc } = buildBalancedDocs(result);

            setEditorContent(leftDoc, rightDoc, result);
        });
    });

    document.getElementById("clear").addEventListener('click', () => { clearFile(); });
    document.getElementById("sidebar-reload").addEventListener('click', () => { reloadFile(); });

    document.getElementById("reset").addEventListener('click', () => {
        const leftDoc = unBalanceDocs(window.leftEditor, leftDiffPlugin).join("\n");
        const rightDoc = unBalanceDocs(window.rightEditor, rightDiffPlugin).join("\n");
        setEditorContent(leftDoc, rightDoc, null);
        document.getElementById("left-count").classList.add("hidden-dn");
        document.getElementById("right-count").classList.add("hidden-dn");
    });

    let hideTimeout = null;
    document.getElementById("spellcheck-toggle").addEventListener("change", function () {
        const state = this.checked ? true : false;

        window.leftEditor.contentDOM.setAttribute("spellcheck", state);
        window.rightEditor.contentDOM.setAttribute("spellcheck", state);
        
        
        const message = document.getElementById("sidebar-messages");
        if (state) {
            message.classList.remove('hidden-message');
            if (hideTimeout) clearTimeout(hideTimeout);
            hideTimeout = setTimeout(() => { message.classList.add('hidden-message'); }, 4000);
        } else {
            if (hideTimeout) clearTimeout(hideTimeout);
            hideTimeout = null;
            message.classList.add('hidden-message');
        }
    });

    document.getElementById("linewrap-toggle").addEventListener("change", function () {
        const state = this.checked ? true : false;
        toggleLineWrapping(window.leftEditor, state);
        toggleLineWrapping(window.rightEditor, state);
    });

    document.getElementById("gap-toggle").addEventListener("change", function () {
        document.getElementById("editor-inner").classList.toggle("nogap", !this.checked);
        document.getElementById("editor-menus").style.gap = this.checked ? "" : "4px";
        document.getElementById("scrollbar-spacer").style.marginLeft = this.checked ? "" : "-4px";
        document.querySelectorAll(".cm-instance").forEach(el => el.style.border = this.checked ? "" : "none");
        document.querySelector("#right-container .cm-gutters").style.borderRadius = this.checked ? "" : "0";

        if (this.checked) {
            document.querySelectorAll(".no-gap-style").forEach(el => el.remove());
        } else {
            // Add cm-focused outline suppressor
            const style1 = document.createElement("style");
            style1.className = "no-gap-style";
            style1.textContent = `.cm-editor.cm-focused { outline: none !important; }`;
            document.head.appendChild(style1);

            // Add outline to editor-inner if it has a focused cm-editor
            const style2 = document.createElement("style");
            style2.className = "no-gap-style";
            style2.textContent = `#editor-inner:has(.cm-focused) { border: 1px solid #aaa; }`;
            document.head.appendChild(style2);
        }
    });

    ["lowercase", "trim"].forEach(action => {
        document.getElementById(action).addEventListener("click", () => {
            manipulateText(action, window.leftEditor);
            manipulateText(action, window.rightEditor);
        });
    });

    ["removeBlank", "concat", "sortAlpha", "sortNum", "sortIP", "uniq"].forEach(action => {
        document.getElementById(action).addEventListener("click", () => {
            recompileText(action, window.leftEditor, leftDiffPlugin);
            recompileText(action, window.rightEditor, rightDiffPlugin);
        });
    });

    ["left-clear", "right-clear"].forEach(side => {
        document.getElementById(side).addEventListener("click", () => {
            clearFile(side.split("-")[0]);
        });
    });

    ["left-reload", "right-reload"].forEach(action => {
        document.getElementById(action).addEventListener("click", () => {
            reloadFile(action.split("-")[0]);
        });
    });

    let leftFile = "";
    let rightFile = "";
    ["left-upload", "right-upload"].forEach(button => {
        document.getElementById(button).addEventListener("change", function () {
            const file = this.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function (e) { loadFile(e, button); };
            reader.readAsText(file);
        });
    });

    setupDropZone("left-container", "left-upload");
    setupDropZone("right-container", "right-upload");
    setupCopyButton("left-copy", window.leftEditor, leftDiffPlugin);
    setupCopyButton("right-copy", window.rightEditor, rightDiffPlugin);

    document.getElementById('scrollTop').addEventListener('click', () => {
        document.getElementById('editor-inner').scrollTo({ top: 0, behavior: 'smooth' });
    });
    
    const resizeObserver = new ResizeObserver(updateUpVisibility);
    resizeObserver.observe(document.getElementById('left-container'));
    resizeObserver.observe(document.getElementById('right-container'));
});