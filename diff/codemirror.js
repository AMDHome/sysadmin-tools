import { EditorView, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection,
         crosshairCursor, highlightActiveLine, keymap, Decoration, ViewPlugin, GutterMarker, gutter } 
        from "https://cdn.jsdelivr.net/npm/@codemirror/view@6.36.3/+esm";
import { EditorState, RangeSetBuilder, StateEffect, Annotation } 
        from "https://cdn.jsdelivr.net/npm/@codemirror/state@6.5.2/+esm";
import { foldGutter, indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldKeymap }
        from "https://cdn.jsdelivr.net/npm/@codemirror/language@6.11.0/+esm";
import { history, defaultKeymap, historyKeymap }
        from "https://cdn.jsdelivr.net/npm/@codemirror/commands@6.8.1/+esm";
import { highlightSelectionMatches, searchKeymap }
        from "https://cdn.jsdelivr.net/npm/@codemirror/search@6.5.10/+esm";
import { lintKeymap } from "https://cdn.jsdelivr.net/npm/@codemirror/lint@6.8.5/+esm";
import { diffWordsWithSpace } from "https://cdn.jsdelivr.net/npm/diff@8.0.2/+esm";

// Run basic Configuration
const basicSetup = (() => [highlightActiveLineGutter(),
                           highlightSpecialChars(),
                           history(),
                           foldGutter(),
                           drawSelection(),
                           dropCursor(),
                           EditorState.allowMultipleSelections.of(!0),
                           indentOnInput(),
                           syntaxHighlighting(defaultHighlightStyle, {fallback:!0}),
                           bracketMatching(),
                           rectangularSelection(),
                           crosshairCursor(),
                           highlightActiveLine(),
                           highlightSelectionMatches(),
                           keymap.of([...defaultKeymap,
                                      ...searchKeymap,
                                      ...historyKeymap,
                                      ...foldKeymap,
                                      ...lintKeymap])
                          ])();

// GutterMarker with line number
class LineNumbers extends GutterMarker {
    constructor(number, classList = []) {
        super();
        this.number = number;
        this.classList = classList
    }

    toDOM() {
        const span = document.createElement("span");
        span.textContent = this.number;
        span.classList.add(...this.classList);
        return span;
    }
}

export const manualRefresh = Annotation.define();

// Effect to update diff highlights
export const setDiffEffect = StateEffect.define();
export const lineVars = {
    recalculateHeight: false,
    pendingLineHeightUpdate: { l: false, r: false },
    updateActiveLine: true,
    heightList: [],
    charWidth: 0,
    lineHeight: 0,
    isDecorated: false,
    isDirty: false
};

function createDiffPlugin(side) {
    return ViewPlugin.fromClass(class {
        constructor(view) {
            this.side = side;
            this.decorations = Decoration.none;
            this.gutter = buildGutter(view, this.decorations);
        }
        update(update) {
            for (const tr of update.transactions) {
                for (const effect of (tr.effects || [])) {
                    if (effect.is(setDiffEffect)) {
                        this.decorations = Decoration.none;
                        if (!lineVars.pendingLineHeightUpdate.l && !lineVars.pendingLineHeightUpdate.r)
                            lineVars.recalculateHeight = lineVars.pendingLineHeightUpdate.l = lineVars.pendingLineHeightUpdate.r = true;
                        this.decorations = buildDecorations(update.view, effect.value.diffResult, this.side);
                        lineVars.isDecorated = this.decorations === Decoration.none ? false : true;
                        this.gutter = buildGutter(update.view, this.decorations);
                        return;
                    }
                }
                if (tr.annotation(manualRefresh)) {
                    this.decorations = updateLineHeights(update.view, this.decorations, this.side);
                }
            }
            if (this.decorations !== Decoration.none && update.docChanged) {
                this.decorations = this.decorations.map(update.changes);
                const doc = update.state.doc;
                const dirtyDecos = [];

                update.changes.iterChanges((fromA, toA, fromB, toB) => {
                    const startLine = doc.lineAt(fromB).number;
                    const endLine = doc.lineAt(toB).number;

                    for (let i = startLine; i <= endLine; i++) {
                        const line = update.state.doc.line(i);
                        dirtyDecos.push(Decoration.line({ class: "line-dirty" }).range(line.from));
                        lineVars.isDirty = true;
                    }
                });

                if (dirtyDecos.length) {
                    this.decorations = this.decorations.update({ add: dirtyDecos });
                }

            }
            if (update.docChanged) {
                this.gutter = buildGutter(update.view, this.decorations);
            }
        }
    }, {
        decorations: v => v.decorations,
        provide: plugin => gutter({
            class: "cm-lineNumbers",
            markers: view => view.plugin(plugin)?.gutter || Decoration.none,
            initialSpacer: () => new LineNumbers("0000"),
            lineMarkerChange: () => true,
        })
    });
}

function mergeSmallDiffs(tokens, minLength = 3) {
    const merged = [];

    let lastAddedIdx = -1;
    let lastRemovedIdx = -1

    for (const token of tokens) {
        if (lastAddedIdx === -1 || lastRemovedIdx === -1) {
            merged.push(token);
            if (token.added) lastAddedIdx = merged.length - 1;
            if (token.removed) lastRemovedIdx = merged.length - 1;
            continue;
        }

        if (token.value.length < minLength && !token.added && !token.removed) {
            merged[lastAddedIdx].count += token.count;
            merged[lastAddedIdx].value += token.value;
            merged[lastRemovedIdx].count += token.count;
            merged[lastRemovedIdx].value += token.value;
            continue;
        }

        if (token.added && lastAddedIdx !== -1 && lastAddedIdx >= merged.length - 2) {
            merged[lastAddedIdx].count += token.count;
            merged[lastAddedIdx].value += token.value;
            continue;
        }
            
        if (token.removed && lastRemovedIdx !== -1 && lastRemovedIdx >= merged.length - 2) {
            merged[lastRemovedIdx].count += token.count;
            merged[lastRemovedIdx].value += token.value;
            continue;
        }

        merged.push(token);
        if (token.added) lastAddedIdx = merged.length - 1;
        if (token.removed) lastRemovedIdx = merged.length - 1;
    }

    return merged;
}


function buildDecorations(view, diffResult, side) {
    const builder = new RangeSetBuilder();
    const docLineCount = view.state.doc.lines;

    const calcLine = view.dom.querySelectorAll(".cm-line")[0];
    const lineWidth = calcLine.getBoundingClientRect().width
                      - (parseFloat(getComputedStyle(calcLine).paddingLeft)
                      + parseFloat(getComputedStyle(calcLine).paddingRight));

    if (!diffResult) return Decoration.none;
    if (lineVars.recalculateHeight) lineVars.heightList = [];

    for (let i = 0; i < diffResult.length; i++) {
        // Get Current line & line number
        const line = diffResult[i];
        const lineNum = view.state.doc.line(i + 1);
        const text = view.state.doc.sliceString(lineNum.from, lineNum.to);

        // Mark Lines
        if(line.status === "inserted") {
            builder.add(lineNum.from, lineNum.from, Decoration.line({ class: (side === "left") ? "line-padding" : "line-inserted" }));
        } else if (line.status === "removed") {
            builder.add(lineNum.from, lineNum.from, Decoration.line({ class: (side === "left") ? "line-deleted" : "line-padding" }));
        } else if (line.status === "changed" || line.status === "cont") {
            builder.add(lineNum.from, lineNum.from, Decoration.line({ class: (side === "left") ? "line-deleted" : "line-inserted" }));
            if (diffResult[i - 1].status === "inserted")
                builder.add(lineNum.from, lineNum.from, Decoration.line({ class: "line-newblock" }));
        }

        // Set Line Height
        if (lineVars.recalculateHeight) {
            const maxLength = Math.max(diffResult[i].lineA.length, diffResult[i].lineB.length);
            lineVars.heightList.push(getNaturalLineHeight(lineWidth, maxLength));
        }
        builder.add(lineNum.from, lineNum.from, Decoration.line({ class: addClass(lineVars.heightList[i]) }));

        // Mark changes w/ word diff
        if (line.status === "changed") {
            const diffs = mergeSmallDiffs(diffWordsWithSpace(line.lineA, line.lineB));
            let pos = 0;

            for (const token of diffs) {
                const len = token.value.length;
                if ((side === "left" && token.removed) || (side === "right" && token.added)) {
                    builder.add(lineNum.from + pos, lineNum.from + pos + len, Decoration.mark({ class: token.removed ? "word-deleted" : "word-inserted" }));
                    pos += len;
                } else if (!token.added && !token.removed) {
                    pos += len;
                }
            }
        }
    }
    lineVars.recalculateHeight = false;
    side === "left" ? lineVars.pendingLineHeightUpdate.l = false : lineVars.pendingLineHeightUpdate.r = false;
    lineVars.isDirty = false;
    
    return builder.finish();
}

function buildGutter(view, decorations) {
    const builder = new RangeSetBuilder();
    const { doc } = view.state;
    let count = 1;

    for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        let isPadded = false;
        let isDirty = false;
        let lineColor = null;
        let classList = [];

        decorations.between(line.from, line.to, (from, to, deco) => {
            if (deco.spec.class === "line-padding") isPadded = true;
            if (deco.spec.class === "line-inserted" || deco.spec.class === "line-deleted") lineColor = deco.spec.class;
            if (deco.spec.class === "line-newblock") classList.push("gutter-" + deco.spec.class);
            if (deco.spec.class === "line-dirty") {
                isDirty = true;
                lineColor = deco.spec.class;
            }
        });

        if (!isPadded && !isDirty) classList.push("gutter-" + lineColor)
        if (isDirty) classList.push("gutter-line-dirty")

        if (classList.length > 0)
            builder.add(line.from, line.from, new LineNumbers(count++, classList));
    }

    return builder.finish();
}

export function getNaturalLineHeight(lineWidth, textLength) {
    return Math.max(lineVars.lineHeight, lineVars.lineHeight * Math.ceil((lineVars.charWidth * textLength) / lineWidth));
}

const definedLineHeights = new Set();
function addClass(height) {
    const className = `lh${height.toString().replace('.', '-')}`;

    if (!definedLineHeights.has(className)) {
        const style = document.createElement("style");
        style.id = className;
        style.textContent = `.${className} { min-height: ${height}px; }`;
        document.head.appendChild(style);
        definedLineHeights.add(className);
    }

    return className;
}

function recalculateLineHeights() {
    const lDoc = window.leftEditor.state.doc;
    const rDoc = window.rightEditor.state.doc;

    const calcLine = window.leftEditor.dom.querySelectorAll(".cm-line")[0];
    const lineWidth = calcLine.getBoundingClientRect().width
                      - (parseFloat(getComputedStyle(calcLine).paddingLeft)
                      + parseFloat(getComputedStyle(calcLine).paddingRight));

    const currentHeights = []

    for (let i = 0; i < lDoc.lines; i++) {
        const maxLength = Math.max(lDoc.line(i + 1).length, rDoc.line(i + 1).length);
        currentHeights.push(getNaturalLineHeight(lineWidth, maxLength));

        if (currentHeights[i] !== lineVars.heightList[i])
            lineVars.pendingLineHeightUpdate.l = lineVars.pendingLineHeightUpdate.r = true;
    }

    lineVars.heightList = currentHeights;
    lineVars.recalculateHeight = false;

    return lineVars.pendingLineHeightUpdate.l && lineVars.pendingLineHeightUpdate.r
}


function updateLineHeights(view, decorations, side) {
    const builder = new RangeSetBuilder();

    decorations.between(0, view.state.doc.length, (from, to, deco) => {
        // Preserve all non-lhXXX decorations
        const className = deco.spec.class;
        if (!className || !className.startsWith("lh")) {
            builder.add(from, to, deco);
            return;
        }

        const lineIndex = view.state.doc.lineAt(from).number - 1;
        const newClass = addClass(lineVars.heightList[lineIndex])

        if (newClass !== className) {
            builder.add(from, from, Decoration.line({ class: newClass }));
        } else {
            builder.add(from, to, deco); // Keep existing if same height
        }
    });
    side === "left" ? lineVars.pendingLineHeightUpdate.l = false : lineVars.pendingLineHeightUpdate.r = false;
    return builder.finish();
}

export function toggleLineWrapping(editor, state) {
    const newExtensions = [
        basicSetup,
        state ? EditorView.lineWrapping : [],
        leftDiffPlugin,
        disableDropExtension
    ];

    editor.dispatch({
        effects: StateEffect.reconfigure.of(newExtensions)
    });
}

function syncActiveLine(fromView, toView, fromPlugin) {
    return EditorView.updateListener.of(update => {
        if (!update.selectionSet || lineVars.isDirty || !lineVars.isDecorated || 
            update.transactions.some(tr => tr.docChanged)) return;

        const line = fromView.state.doc.lineAt(update.state.selection.main.head).number;

        const maxLine = toView.state.doc.lines;
        const safeLine = Math.min(line, maxLine);
        const linePos = toView.state.doc.line(safeLine).from;

        const currentLine = toView.state.doc.lineAt(toView.state.selection.main.head).number;
        if (safeLine !== currentLine) {
            toView.dispatch({
                selection: { anchor: linePos },
                scrollIntoView: true
            });
        }
    });
}

export const leftDiffPlugin = createDiffPlugin("left");
export const rightDiffPlugin = createDiffPlugin("right");

const disableDropExtension = EditorView.domEventHandlers({
  dragover: (event) => { event.preventDefault(); return true; },
  drop: (event) => { event.preventDefault(); return true; }
});

document.addEventListener("DOMContentLoaded", () => {
    // Setup CM Editors
    window.leftEditor = new EditorView({
        doc: "",
        extensions: [basicSetup, EditorView.lineWrapping, leftDiffPlugin, disableDropExtension],
        parent: document.getElementById("left-container")
    })

    window.rightEditor = new EditorView({
        doc: "",
        extensions: [basicSetup, EditorView.lineWrapping, rightDiffPlugin, disableDropExtension],
        parent: document.getElementById("right-container")
    })

    lineVars.charWidth = document.querySelector(".gutter-null").getBoundingClientRect().width
    lineVars.lineHeight = parseFloat(getComputedStyle(document.querySelector('.cm-line')).lineHeight);
    
    window.leftEditor.dispatch({
        effects: StateEffect.appendConfig.of([syncActiveLine(window.leftEditor, window.rightEditor, leftDiffPlugin)])
    });

    window.rightEditor.dispatch({
        effects: StateEffect.appendConfig.of([syncActiveLine(window.rightEditor, window.leftEditor, rightDiffPlugin)])
    });

    let resizeTimeout = null;
    let leftPlugin = window.leftEditor.plugin(leftDiffPlugin)
    window.addEventListener("resize", () => {
        clearTimeout(resizeTimeout);

        if (!lineVars.isDirty && leftPlugin && leftPlugin.decorations !== Decoration.none) {
            resizeTimeout = setTimeout(() => {
                lineVars.recalculateHeight = true;
                if (recalculateLineHeights()) {
                    window.leftEditor.dispatch({ annotations: manualRefresh.of(true) });
                    window.rightEditor.dispatch({ annotations: manualRefresh.of(true) });
                }
            }, 0);
        }
    });

});