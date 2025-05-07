import { EditorView, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection,
         crosshairCursor, highlightActiveLine, keymap, Decoration, ViewPlugin, GutterMarker, gutter } 
        from "https://cdn.jsdelivr.net/npm/@codemirror/view@6.36.3/+esm";
import { EditorState, RangeSetBuilder, StateEffect } from"https://cdn.jsdelivr.net/npm/@codemirror/state@6.5.2/+esm";
import { foldGutter, indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldKeymap }
        from "https://cdn.jsdelivr.net/npm/@codemirror/language@6.11.0/+esm";
import { history, defaultKeymap, historyKeymap }
        from "https://cdn.jsdelivr.net/npm/@codemirror/commands@6.8.1/+esm";
import { highlightSelectionMatches, searchKeymap }
        from "https://cdn.jsdelivr.net/npm/@codemirror/search@6.5.10/+esm";
import { lintKeymap } from "https://cdn.jsdelivr.net/npm/@codemirror/lint@6.8.5/+esm";
import { diffWordsWithSpace } from "https://cdn.jsdelivr.net/npm/diff@7.0.0/+esm";

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
    constructor(number, color = null) {
        super();
        this.number = number;
        this.color = color;
    }

    toDOM() {
        const span = document.createElement("span");
        span.textContent = this.number;
        span.classList.add(this.color);
        return span;
    }
}

// Effect to update diff highlights
export const setDiffEffect = StateEffect.define();

function createDiffPlugin(side) {
    return ViewPlugin.fromClass(class {
        constructor(view) {
            this.side = side;
            this.decorations = Decoration.none;
            this.gutter = buildGutter(view, this.decorations);
        }

        update(update) {
            for (const tr of update.transactions) {
                for (const effect of tr.effects) {
                    if (effect.is(setDiffEffect)) {
                        this.decorations = Decoration.none;
                        this.decorations = buildDecorations(update.view, effect.value.diffResult, this.side);
                        this.gutter = buildGutter(update.view, this.decorations);
                        return;
                    }
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
                    }
                });

                if (dirtyDecos.length) {
                    this.decorations = this.decorations.update({ add: dirtyDecos });
                    this.gutter = buildGutter(update.view, this.decorations);
                }
            }
            if (update.docChanged || update.viewportChanged) {
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

function buildDecorations(view, diffResult, side) {
    const builder = new RangeSetBuilder();
    const docLineCount = view.state.doc.lines;

    if (!diffResult) return Decoration.none;

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
        } else if (line.status === "changed") {
            builder.add(lineNum.from, lineNum.from, Decoration.line({ class: (side === "left") ? "line-deleted" : "line-inserted" }));
        }

        // Mark changes w/ word diff
        if (line.status === "changed") {
            const diffs = diffWordsWithSpace(line.lineA, line.lineB);
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

        decorations.between(line.from, line.to, (from, to, deco) => {
            if (deco.spec.class === "line-padding") isPadded = true;
            if (deco.spec.class === "line-inserted" || deco.spec.class === "line-deleted") lineColor = deco.spec.class;
            if (deco.spec.class === "line-dirty") {
                isDirty = true;
                lineColor = deco.spec.class;
            }
        });

        if (!isPadded && !isDirty)  builder.add(line.from, line.from, new LineNumbers(count++, "gutter-" + lineColor));
        if (isDirty)  builder.add(line.from, line.from, new LineNumbers(count++, "gutter-line-dirty"));
    }

    return builder.finish();
}

export const leftDiffPlugin = createDiffPlugin("left");
export const rightDiffPlugin = createDiffPlugin("right");

// Setup CM Editors
window.leftEditor = new EditorView({
    doc: "",
    extensions: [basicSetup, EditorView.lineWrapping, leftDiffPlugin],
    parent: document.getElementById("left-container")
})

window.rightEditor = new EditorView({
    doc: "",
    extensions: [basicSetup, EditorView.lineWrapping, rightDiffPlugin],
    parent: document.getElementById("right-container")
})