import { patienceDiff } from './patienceDiff.js';
import { setDiffEffect, rightDiffPlugin, leftDiffPlugin } from './codemirror.js';
import { compareTwoStrings } from "https://cdn.jsdelivr.net/npm/string-similarity@4.0.4/+esm";

function balanceBlock(removedLines, insertedLines, removedIndex, insertedIndex) {
    let lastMatchedIndex = -1; // to keep B in order
    const usedBIndexes = new Set();
    const similarL2R = [];
    const balanced = [];

    // Attempt to pair each removed lines
    removedLines.forEach((lineA, indexA) => {
        let bestScore = 0;
        let bestIndex = -1;

        for (let i = lastMatchedIndex + 1; i < insertedLines.length; i++) {
            if (usedBIndexes.has(i)) continue;

            const score = compareTwoStrings(lineA.trim(), insertedLines[i].trim());

            if (score > bestScore) {
                bestScore = score;
                bestIndex = i;
            }
        }

        if (bestScore > 0.55 && bestIndex !== -1) {
            usedBIndexes.add(bestIndex);
            lastMatchedIndex = bestIndex;
            similarL2R.push({ aIndex: indexA + removedIndex, bIndex: bestIndex + insertedIndex,
                              status: lineA === insertedLines[bestIndex] ? 'identical' : 'changed', score: bestScore,
                              lineA: lineA, lineB: insertedLines[bestIndex] });
        } else {
            similarL2R.push({ aIndex: indexA + removedIndex, bIndex: -1, status: 'removed', score: bestScore,
                              lineA: lineA, lineB: '' });
        }
    });

    // Add back in unpaired inserted Lines
    let nextB = insertedIndex;
    for (let i = 0; i < similarL2R.length; i++) {
        if (similarL2R[i].bIndex != -1 && similarL2R[i].bIndex > nextB) {
            for (;similarL2R[i].bIndex > nextB; nextB++) {
                balanced.push({ aIndex: -1, bIndex: nextB, status: 'inserted', 
                              lineA: "", lineB: insertedLines[nextB - insertedIndex] });
            }
        }
        balanced.push(similarL2R[i]);
        if (similarL2R[i].bIndex === nextB) nextB = nextB + 1;
    }

    // Add back in inserted lines after the last removed line
    for (let j = nextB - insertedIndex; j < insertedLines.length; j++) {
        balanced.push({ aIndex: -1, bIndex: nextB, status: 'inserted', lineA: "", lineB: insertedLines[nextB - insertedIndex] });
        nextB++;
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
    
    buttonText.forEach(text => text.classList.toggle('hidden'));
    setTimeout(() => {
        buttonText.forEach(text => text.classList.toggle('hidden'));
    }, 1000);
}

function setEditorContent(leftText = "", rightText = "", diffDeco = null) {
    // Set text content
    window.leftEditor.dispatch({
        changes: { from: 0, to: window.leftEditor.state.doc.length, insert: leftText }
    });
    
    window.rightEditor.dispatch({
        changes: { from: 0, to: window.rightEditor.state.doc.length, insert: rightText }
    });

    // Then apply diff decorations
    window.leftEditor.dispatch({ effects: setDiffEffect.of({ diffResult: diffDeco }) });
    window.rightEditor.dispatch({ effects: setDiffEffect.of({ diffResult: diffDeco }) });
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

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById('run-diff').addEventListener('click', () => {
        const text1 = unBalanceDocs(window.leftEditor, leftDiffPlugin);
        const text2 = unBalanceDocs(window.rightEditor, rightDiffPlugin);

        // Add padded text into both editors to make the diff side by side
        const result = balancePatienceOutput(patienceDiff(text1, text2).lines);
        const { leftDoc, rightDoc } = buildBalancedDocs(result);

        setEditorContent(leftDoc, rightDoc, result);
    });

    document.getElementById('clear').addEventListener('click', () => {
        setEditorContent();
    });

    document.getElementById('reset').addEventListener('click', () => {
        const leftDoc = unBalanceDocs(window.leftEditor, leftDiffPlugin).join("\n");
        const rightDoc = unBalanceDocs(window.rightEditor, rightDiffPlugin).join("\n");
        setEditorContent(leftDoc, rightDoc);
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

    setupCopyButton("left-copy", window.leftEditor, leftDiffPlugin);
    setupCopyButton("right-copy", window.rightEditor, rightDiffPlugin);
});