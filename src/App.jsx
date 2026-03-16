import { useState, useEffect, useRef, useCallback, useMemo, useReducer } from "react";
import {
  FileUp, Save, Download, ZoomIn, ZoomOut,
  Undo2, Redo2, Type, Image, Square, Circle, Minus, ArrowRight,
  Star, Triangle, MousePointer2, ChevronLeft, ChevronRight,
  PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen,
  Trash2, Bold, Italic,
  Underline, AlignLeft, AlignCenter, AlignRight, Maximize,
  X, GripVertical, MoveUp, MoveDown,
  FileText, GitMerge, Archive,
  Check, CircleAlert, Loader2, Upload
} from "lucide-react";

/* ─── Constants ─── */
const TOOLS = {
  SELECT: "select", TEXT: "text", IMAGE: "image",
  RECT: "rectangle", CIRCLE: "circle", LINE: "line",
  ARROW: "arrow", STAR: "star", TRIANGLE: "triangle"
};
const FONTS = ["Helvetica", "Times-Roman", "Courier", "Georgia", "Verdana"];
const COLORS = ["#000000","#ffffff","#ff0000","#0066ff","#00cc66","#ff9900","#9933ff","#ff3399","#666666","#cccccc"];
const MAX_HISTORY = 50;
const HANDLE_SIZE = 8;
const MIN_DIM = 20;

const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";
const PDFJS_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";
const PDFLIB_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js";

/* ─── ID Generator ─── */
let _idCounter = 0;
const uid = () => `ann_${Date.now()}_${++_idCounter}`;

/* ─── Annotation Factory ─── */
function createAnnotation(type, x, y, extra = {}) {
  const base = {
    id: uid(), type, x, y, width: 150, height: 40,
    rotation: 0, zIndex: Date.now(), opacity: 1,
    ...extra
  };
  switch (type) {
    case "text":
      return { ...base, text: "Text eingeben", fontFamily: "Helvetica", fontSize: 16, fontColor: "#000000", bold: false, italic: false, underline: false, align: "left", width: 200, height: 30 };
    case "image":
      return { ...base, src: extra.src || "", width: extra.width || 200, height: extra.height || 200, preserveAspect: true };
    case "rectangle":
      return { ...base, fill: "#0066ff33", stroke: "#0066ff", strokeWidth: 2, width: 120, height: 80 };
    case "circle":
      return { ...base, fill: "#00cc6633", stroke: "#00cc66", strokeWidth: 2, width: 100, height: 100 };
    case "line":
      return { ...base, stroke: "#000000", strokeWidth: 2, width: 150, height: 0 };
    case "arrow":
      return { ...base, stroke: "#000000", strokeWidth: 2, width: 150, height: 0 };
    case "star":
      return { ...base, fill: "#ff990033", stroke: "#ff9900", strokeWidth: 2, width: 80, height: 80 };
    case "triangle":
      return { ...base, fill: "#9933ff33", stroke: "#9933ff", strokeWidth: 2, width: 100, height: 90 };
    default:
      return base;
  }
}

/* ─── Reducer ─── */
const initialState = {
  file: null, pdfBytes: null, pageCount: 0, currentPage: 1,
  zoom: 1, fitMode: null, tool: TOOLS.SELECT,
  annotations: {}, selection: new Set(), clipboard: [],
  history: { past: [], future: [] },
  ui: { sidebarOpen: true, propsOpen: false, mergeMode: false, compressResult: null },
  mergeFiles: [], editingTextId: null
};

function cloneAnns(anns) {
  const c = {};
  for (const k in anns) c[k] = anns[k].map(a => ({ ...a }));
  return c;
}

function pushHistory(state) {
  const past = [...state.history.past, {
    annotations: cloneAnns(state.annotations),
    selection: new Set(state.selection)
  }].slice(-MAX_HISTORY);
  return { past, future: [] };
}

function reducer(state, action) {
  switch (action.type) {
    case "SET_FILE":
      return { ...state, file: action.file, pdfBytes: action.pdfBytes, pageCount: action.pageCount, currentPage: 1, annotations: {}, selection: new Set(), history: { past: [], future: [] }, ui: { ...state.ui, compressResult: null } };
    case "SET_PAGE":
      return { ...state, currentPage: Math.max(1, Math.min(action.page, state.pageCount)), selection: new Set(), editingTextId: null };
    case "SET_ZOOM":
      return { ...state, zoom: Math.max(0.25, Math.min(4, action.zoom)), fitMode: action.fitMode || null };
    case "SET_TOOL":
      return { ...state, tool: action.tool, editingTextId: null };
    case "ADD_ANNOTATION": {
      const history = pushHistory(state);
      const pg = action.page || state.currentPage;
      const anns = { ...state.annotations, [pg]: [...(state.annotations[pg] || []), action.annotation] };
      return { ...state, annotations: anns, selection: new Set([action.annotation.id]), history, tool: action.keepTool ? state.tool : TOOLS.SELECT, ui: { ...state.ui, propsOpen: true } };
    }
    case "UPDATE_ANNOTATION": {
      const history = action.noHistory ? state.history : pushHistory(state);
      const pg = action.page || state.currentPage;
      const anns = { ...state.annotations, [pg]: (state.annotations[pg] || []).map(a => a.id === action.id ? { ...a, ...action.changes } : a) };
      return { ...state, annotations: anns, history };
    }
    case "DELETE_SELECTION": {
      if (state.selection.size === 0) return state;
      const history = pushHistory(state);
      const pg = state.currentPage;
      const anns = { ...state.annotations, [pg]: (state.annotations[pg] || []).filter(a => !state.selection.has(a.id)) };
      return { ...state, annotations: anns, selection: new Set(), history, editingTextId: null, ui: { ...state.ui, propsOpen: false } };
    }
    case "SET_SELECTION":
      return { ...state, selection: action.selection, editingTextId: null, ui: { ...state.ui, propsOpen: action.selection.size > 0 } };
    case "TOGGLE_SELECTION": {
      const s = new Set(state.selection);
      if (s.has(action.id)) s.delete(action.id); else s.add(action.id);
      return { ...state, selection: s, ui: { ...state.ui, propsOpen: s.size > 0 } };
    }
    case "UNDO": {
      if (state.history.past.length === 0) return state;
      const prev = state.history.past[state.history.past.length - 1];
      const past = state.history.past.slice(0, -1);
      const future = [{ annotations: cloneAnns(state.annotations), selection: new Set(state.selection) }, ...state.history.future];
      return { ...state, annotations: prev.annotations, selection: prev.selection, history: { past, future }, editingTextId: null };
    }
    case "REDO": {
      if (state.history.future.length === 0) return state;
      const next = state.history.future[0];
      const future = state.history.future.slice(1);
      const past = [...state.history.past, { annotations: cloneAnns(state.annotations), selection: new Set(state.selection) }];
      return { ...state, annotations: next.annotations, selection: next.selection, history: { past, future }, editingTextId: null };
    }
    case "SET_EDITING_TEXT":
      return { ...state, editingTextId: action.id };
    case "SET_UI":
      return { ...state, ui: { ...state.ui, ...action.ui } };
    case "SET_MERGE_FILES":
      return { ...state, mergeFiles: action.files };
    case "SET_ANNOTATIONS":
      return { ...state, annotations: action.annotations };
    case "MOVE_ANNOTATION_Z": {
      const history = pushHistory(state);
      const pg = state.currentPage;
      const list = [...(state.annotations[pg] || [])];
      const idx = list.findIndex(a => a.id === action.id);
      if (idx < 0) return state;
      if (action.dir === "up" && idx < list.length - 1) { [list[idx], list[idx + 1]] = [list[idx + 1], list[idx]]; }
      if (action.dir === "down" && idx > 0) { [list[idx], list[idx - 1]] = [list[idx - 1], list[idx]]; }
      return { ...state, annotations: { ...state.annotations, [pg]: list }, history };
    }
    case "SET_PAGE_COUNT":
      return { ...state, pageCount: action.pageCount };
    case "SET_PDF_BYTES":
      return { ...state, pdfBytes: action.pdfBytes, file: action.file || state.file, ui: { ...state.ui, compressResult: action.compressResult || null } };
    default:
      return state;
  }
}

/* ─── Tooltip Component ─── */
function Tip({ text, shortcut, children }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <div className="absolute z-[9999] top-full left-1/2 -translate-x-1/2 mt-1 px-2 py-1 text-xs rounded shadow-lg whitespace-nowrap pointer-events-none" style={{ background: "#1e1e2e", color: "#e0e0e0", border: "1px solid #333" }}>
          {text}{shortcut && <span className="ml-1 opacity-60">({shortcut})</span>}
        </div>
      )}
    </div>
  );
}

/* ─── Toolbar Button ─── */
function TBtn({ icon: Icon, active, onClick, disabled, tip, shortcut, size = 18 }) {
  return (
    <Tip text={tip} shortcut={shortcut}>
      <button
        onClick={onClick} disabled={disabled}
        className={`p-1.5 rounded transition-colors ${active ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-white/10"} ${disabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer"}`}
      >
        <Icon size={size} />
      </button>
    </Tip>
  );
}

/* ─── Color Picker ─── */
function ColorPick({ value, onChange, label }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 w-16">{label}</span>
      <div className="flex gap-1 flex-wrap">
        {COLORS.map(c => (
          <button key={c} onClick={() => onChange(c)}
            className={`w-5 h-5 rounded border ${value === c ? "ring-2 ring-blue-500 ring-offset-1 ring-offset-gray-800" : "border-gray-600"}`}
            style={{ background: c }}
          />
        ))}
      </div>
      <input type="color" value={value || "#000000"} onChange={e => onChange(e.target.value)} className="w-6 h-6 rounded cursor-pointer bg-transparent border-0" />
    </div>
  );
}

/* ─── Main App ─── */
export default function MiniAcrobat() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [libs, setLibs] = useState({ pdfjs: null, pdfLib: null });
  const [pdfDoc, setPdfDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pageRendering, setPageRendering] = useState(false);
  const [thumbnails, setThumbnails] = useState({});
  const [canvasDims, setCanvasDims] = useState({ width: 0, height: 0 });
  const [dragState, setDragState] = useState(null);
  const [saveName, setSaveName] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [saving, setSaving] = useState(false);

  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const containerRef = useRef(null);
  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const mergeInputRef = useRef(null);
  const renderTaskRef = useRef(null);

  const { file, pdfBytes, pageCount, currentPage, zoom, tool, annotations, selection, ui, editingTextId, mergeFiles } = state;
  const currentAnnotations = annotations[currentPage] || [];
  const selectedAnnotation = currentAnnotations.find(a => selection.has(a.id));

  /* ─── Load Libraries ─── */
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // Load pdf-lib via script tag
        if (!window.PDFLib) {
          await new Promise((res, rej) => {
            const s = document.createElement("script");
            s.src = PDFLIB_URL;
            s.onload = res;
            s.onerror = () => rej(new Error("pdf-lib konnte nicht geladen werden"));
            document.head.appendChild(s);
          });
        }
        // Load PDF.js as ES module
        const pdfjsMod = await import(PDFJS_URL);
        const pdfjs = pdfjsMod;
        pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;

        if (!cancelled) {
          setLibs({ pdfjs, pdfLib: window.PDFLib });
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) { setError(e.message); setLoading(false); }
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  /* ─── Open PDF ─── */
  const openPDF = useCallback(async (arrayBuffer, name) => {
    if (!libs.pdfjs) return;
    try {
      const bytes = new Uint8Array(arrayBuffer);
      const doc = await libs.pdfjs.getDocument({ data: bytes.slice() }).promise;
      setPdfDoc(doc);
      dispatch({ type: "SET_FILE", file: { name, size: bytes.length }, pdfBytes: bytes, pageCount: doc.numPages });
      setSaveName(name.replace(/\.pdf$/i, "") + "_edited.pdf");
      setThumbnails({});
    } catch (e) {
      setError("PDF konnte nicht geöffnet werden: " + e.message);
    }
  }, [libs.pdfjs]);

  const handleFileOpen = useCallback((e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => openPDF(reader.result, f.name);
    reader.readAsArrayBuffer(f);
    e.target.value = "";
  }, [openPDF]);

  /* ─── Drag & Drop ─── */
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer?.files?.[0];
    if (f && f.type === "application/pdf") {
      const reader = new FileReader();
      reader.onload = () => openPDF(reader.result, f.name);
      reader.readAsArrayBuffer(f);
    }
  }, [openPDF]);

  /* ─── Render Page ─── */
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let cancelled = false;
    setPageRendering(true);

    (async () => {
      try {
        if (renderTaskRef.current) { renderTaskRef.current.cancel(); renderTaskRef.current = null; }
        const page = await pdfDoc.getPage(currentPage);
        const dpr = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: zoom * dpr });
        const canvas = canvasRef.current;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = (viewport.width / dpr) + "px";
        canvas.style.height = (viewport.height / dpr) + "px";

        setCanvasDims({ width: viewport.width / dpr, height: viewport.height / dpr });

        const ctx = canvas.getContext("2d");
        const task = page.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        await task.promise;
        if (!cancelled) setPageRendering(false);
      } catch (e) {
        if (e?.name !== "RenderingCancelledException" && !cancelled) {
          setPageRendering(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [pdfDoc, currentPage, zoom]);

  /* ─── Generate Thumbnails ─── */
  useEffect(() => {
    if (!pdfDoc || !ui.sidebarOpen) return;
    let cancelled = false;
    (async () => {
      for (let i = 1; i <= Math.min(pageCount, 100); i++) {
        if (cancelled || thumbnails[i]) continue;
        try {
          const page = await pdfDoc.getPage(i);
          const vp = page.getViewport({ scale: 0.2 });
          const c = document.createElement("canvas");
          c.width = vp.width; c.height = vp.height;
          await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
          if (!cancelled) setThumbnails(prev => ({ ...prev, [i]: c.toDataURL() }));
        } catch { /* skip */ }
      }
    })();
    return () => { cancelled = true; };
  }, [pdfDoc, pageCount, ui.sidebarOpen]);

  /* ─── Keyboard Shortcuts ─── */
  useEffect(() => {
    const handleKey = (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === "z" && !e.shiftKey) { e.preventDefault(); dispatch({ type: "UNDO" }); }
      else if (ctrl && e.key === "z" && e.shiftKey) { e.preventDefault(); dispatch({ type: "REDO" }); }
      else if (ctrl && e.key === "Z") { e.preventDefault(); dispatch({ type: "REDO" }); }
      else if (ctrl && e.key === "s") { e.preventDefault(); setShowSaveDialog(true); }
      else if (ctrl && e.key === "o") { e.preventDefault(); fileInputRef.current?.click(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && !editingTextId) { e.preventDefault(); dispatch({ type: "DELETE_SELECTION" }); }
      else if (e.key === "Escape") { dispatch({ type: "SET_SELECTION", selection: new Set() }); dispatch({ type: "SET_TOOL", tool: TOOLS.SELECT }); }
      else if (e.key === "t" && !ctrl && !editingTextId && document.activeElement?.tagName !== "INPUT") { dispatch({ type: "SET_TOOL", tool: TOOLS.TEXT }); }
      else if (e.key === "v" && !ctrl && !editingTextId && document.activeElement?.tagName !== "INPUT") { dispatch({ type: "SET_TOOL", tool: TOOLS.SELECT }); }
      else if (ctrl && (e.key === "=" || e.key === "+")) { e.preventDefault(); dispatch({ type: "SET_ZOOM", zoom: zoom + 0.1 }); }
      else if (ctrl && e.key === "-") { e.preventDefault(); dispatch({ type: "SET_ZOOM", zoom: zoom - 0.1 }); }
      else if (ctrl && e.key === "0") { e.preventDefault(); dispatch({ type: "SET_ZOOM", zoom: 1, fitMode: "page" }); }
      else if (e.key === "ArrowLeft" && !editingTextId && selection.size > 0) { e.preventDefault(); moveSelected(-1, 0); }
      else if (e.key === "ArrowRight" && !editingTextId && selection.size > 0) { e.preventDefault(); moveSelected(1, 0); }
      else if (e.key === "ArrowUp" && !editingTextId && selection.size > 0) { e.preventDefault(); moveSelected(0, -1); }
      else if (e.key === "ArrowDown" && !editingTextId && selection.size > 0) { e.preventDefault(); moveSelected(0, 1); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [zoom, selection, editingTextId]);

  const moveSelected = useCallback((dx, dy) => {
    selection.forEach(id => {
      dispatch({ type: "UPDATE_ANNOTATION", id, changes: { x: (currentAnnotations.find(a => a.id === id)?.x || 0) + dx, y: (currentAnnotations.find(a => a.id === id)?.y || 0) + dy }, noHistory: true });
    });
  }, [selection, currentAnnotations]);

  /* ─── Canvas Click → Place Annotation ─── */
  const handleCanvasClick = useCallback((e) => {
    if (tool === TOOLS.SELECT) {
      if (e.target === overlayRef.current) {
        dispatch({ type: "SET_SELECTION", selection: new Set() });
      }
      return;
    }
    if (!overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (tool === TOOLS.TEXT) {
      const ann = createAnnotation("text", x, y);
      dispatch({ type: "ADD_ANNOTATION", annotation: ann });
      dispatch({ type: "SET_EDITING_TEXT", id: ann.id });
    } else if (tool === TOOLS.IMAGE) {
      imageInputRef.current?.click();
      imageInputRef.current._placeXY = { x, y };
    } else if ([TOOLS.RECT, TOOLS.CIRCLE, TOOLS.LINE, TOOLS.ARROW, TOOLS.STAR, TOOLS.TRIANGLE].includes(tool)) {
      const ann = createAnnotation(tool, x - 50, y - 40);
      dispatch({ type: "ADD_ANNOTATION", annotation: ann, keepTool: true });
    }
  }, [tool]);

  /* ─── Image Upload Handler ─── */
  const handleImageUpload = useCallback((e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        const pos = imageInputRef.current?._placeXY || { x: 100, y: 100 };
        const maxW = 300;
        const scale = img.width > maxW ? maxW / img.width : 1;
        const ann = createAnnotation("image", pos.x, pos.y, {
          src: reader.result, width: img.width * scale, height: img.height * scale,
          origWidth: img.width, origHeight: img.height
        });
        dispatch({ type: "ADD_ANNOTATION", annotation: ann });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
    e.target.value = "";
  }, []);

  /* ─── Drag & Drop Engine ─── */
  const handleAnnotationMouseDown = useCallback((e, ann, handleType) => {
    e.stopPropagation();
    e.preventDefault();
    if (editingTextId === ann.id && handleType === "move") return;

    if (handleType === "move") {
      if (!selection.has(ann.id)) {
        if (e.shiftKey) { dispatch({ type: "TOGGLE_SELECTION", id: ann.id }); }
        else { dispatch({ type: "SET_SELECTION", selection: new Set([ann.id]) }); }
      }
    }

    const startX = e.clientX;
    const startY = e.clientY;
    const startAnns = {};
    const toMove = selection.has(ann.id) ? [...selection] : [ann.id];
    toMove.forEach(id => {
      const a = currentAnnotations.find(x => x.id === id);
      if (a) startAnns[id] = { x: a.x, y: a.y, width: a.width, height: a.height, rotation: a.rotation };
    });

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      Object.entries(startAnns).forEach(([id, start]) => {
        let changes = {};
        if (handleType === "move") {
          changes = { x: start.x + dx, y: start.y + dy };
        } else if (handleType === "rotate") {
          const cx = start.x + start.width / 2;
          const cy = start.y + start.height / 2;
          const angle = Math.atan2(ev.clientY - (overlayRef.current?.getBoundingClientRect().top + cy), ev.clientX - (overlayRef.current?.getBoundingClientRect().left + cx));
          changes = { rotation: (angle * 180 / Math.PI) + 90 };
        } else {
          // Resize handles
          let nx = start.x, ny = start.y, nw = start.width, nh = start.height;
          if (handleType.includes("e")) { nw = Math.max(MIN_DIM, start.width + dx); }
          if (handleType.includes("w")) { nw = Math.max(MIN_DIM, start.width - dx); nx = start.x + dx; if (nw === MIN_DIM) nx = start.x + start.width - MIN_DIM; }
          if (handleType.includes("s")) { nh = Math.max(MIN_DIM, start.height + dy); }
          if (handleType.includes("n")) { nh = Math.max(MIN_DIM, start.height - dy); ny = start.y + dy; if (nh === MIN_DIM) ny = start.y + start.height - MIN_DIM; }
          if (ev.shiftKey && ann.type === "image") {
            /* free resize when shift held */
          } else if (ann.type === "image" && ann.preserveAspect) {
            const ratio = start.width / start.height;
            if (Math.abs(dx) > Math.abs(dy)) { nh = nw / ratio; }
            else { nw = nh * ratio; }
          }
          changes = { x: nx, y: ny, width: nw, height: nh };
        }
        dispatch({ type: "UPDATE_ANNOTATION", id, changes, noHistory: true });
      });
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      // Push a single history entry
      dispatch({ type: "UPDATE_ANNOTATION", id: ann.id, changes: {}, noHistory: false });
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [selection, currentAnnotations, editingTextId]);

  /* ─── Save / Export ─── */
  const handleSave = useCallback(async () => {
    if (!libs.pdfLib || !pdfBytes) return;
    setSaving(true);
    try {
      const { PDFDocument, rgb, StandardFonts } = libs.pdfLib;
      const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

      for (const [pgStr, anns] of Object.entries(annotations)) {
        const pgNum = parseInt(pgStr);
        if (pgNum < 1 || pgNum > doc.getPageCount()) continue;
        const page = doc.getPage(pgNum - 1);
        const { width: pw, height: ph } = page.getSize();
        const sx = pw / canvasDims.width;
        const sy = ph / canvasDims.height;

        for (const ann of anns) {
          const ax = ann.x * sx;
          const ay = ph - (ann.y + ann.height) * sy;
          const aw = ann.width * sx;
          const ah = ann.height * sy;

          if (ann.type === "text") {
            let fontKey = StandardFonts.Helvetica;
            if (ann.fontFamily === "Times-Roman") fontKey = ann.bold ? StandardFonts.TimesRomanBold : StandardFonts.TimesRoman;
            else if (ann.fontFamily === "Courier") fontKey = ann.bold ? StandardFonts.CourierBold : StandardFonts.Courier;
            else fontKey = ann.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica;
            const font = await doc.embedFont(fontKey);
            const c = hexToRgb(ann.fontColor);
            page.drawText(ann.text || "", {
              x: ax, y: ay + ah * 0.2, size: ann.fontSize * sx,
              font, color: rgb(c.r / 255, c.g / 255, c.b / 255),
              opacity: ann.opacity
            });
          } else if (ann.type === "image" && ann.src) {
            try {
              const resp = await fetch(ann.src);
              const buf = await resp.arrayBuffer();
              let img;
              if (ann.src.includes("image/png")) img = await doc.embedPng(buf);
              else img = await doc.embedJpg(buf);
              page.drawImage(img, { x: ax, y: ay, width: aw, height: ah, opacity: ann.opacity });
            } catch { /* skip failed images */ }
          } else if (ann.type === "rectangle") {
            const fc = hexToRgb(ann.fill);
            const sc = hexToRgb(ann.stroke);
            page.drawRectangle({
              x: ax, y: ay, width: aw, height: ah,
              color: rgb(fc.r / 255, fc.g / 255, fc.b / 255),
              borderColor: rgb(sc.r / 255, sc.g / 255, sc.b / 255),
              borderWidth: ann.strokeWidth, opacity: parseAlpha(ann.fill)
            });
          } else if (ann.type === "circle") {
            const fc = hexToRgb(ann.fill);
            const sc = hexToRgb(ann.stroke);
            page.drawEllipse({
              x: ax + aw / 2, y: ay + ah / 2, xScale: aw / 2, yScale: ah / 2,
              color: rgb(fc.r / 255, fc.g / 255, fc.b / 255),
              borderColor: rgb(sc.r / 255, sc.g / 255, sc.b / 255),
              borderWidth: ann.strokeWidth, opacity: parseAlpha(ann.fill)
            });
          } else if (ann.type === "line" || ann.type === "arrow") {
            const sc = hexToRgb(ann.stroke);
            page.drawLine({
              start: { x: ax, y: ay + ah }, end: { x: ax + aw, y: ay },
              color: rgb(sc.r / 255, sc.g / 255, sc.b / 255),
              thickness: ann.strokeWidth, opacity: ann.opacity
            });
          }
        }
      }

      const bytes = await doc.save();
      downloadBytes(bytes, saveName || "output.pdf");
      setShowSaveDialog(false);
    } catch (e) {
      setError("Export fehlgeschlagen: " + e.message);
    } finally { setSaving(false); }
  }, [libs.pdfLib, pdfBytes, annotations, canvasDims, saveName]);

  /* ─── Compress ─── */
  const handleCompress = useCallback(async () => {
    if (!libs.pdfLib || !pdfBytes) return;
    setCompressing(true);
    try {
      const { PDFDocument } = libs.pdfLib;
      const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
      // Remove metadata to save space, optimize structure
      doc.setTitle(""); doc.setAuthor(""); doc.setSubject(""); doc.setKeywords([]); doc.setCreator(""); doc.setProducer("");
      const compressed = await doc.save({
        useObjectStreams: true,
        addDefaultPage: false,
        objectsPerTick: 100
      });
      const savedPct = ((1 - compressed.length / pdfBytes.length) * 100).toFixed(1);
      dispatch({ type: "SET_PDF_BYTES", pdfBytes: new Uint8Array(compressed), compressResult: { original: pdfBytes.length, compressed: compressed.length, savedPct } });
      // Reload in viewer
      const newDoc = await libs.pdfjs.getDocument({ data: compressed.slice() }).promise;
      setPdfDoc(newDoc);
    } catch (e) {
      setError("Komprimierung fehlgeschlagen: " + e.message);
    } finally { setCompressing(false); }
  }, [libs, pdfBytes]);

  /* ─── Merge ─── */
  const handleMergeFiles = useCallback((e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const promises = files.map(f => new Promise((res) => {
      const reader = new FileReader();
      reader.onload = () => res({ name: f.name, data: new Uint8Array(reader.result) });
      reader.readAsArrayBuffer(f);
    }));
    Promise.all(promises).then(results => {
      dispatch({ type: "SET_MERGE_FILES", files: [...mergeFiles, ...results] });
      setShowMerge(true);
    });
    e.target.value = "";
  }, [mergeFiles]);

  const executeMerge = useCallback(async () => {
    if (!libs.pdfLib || mergeFiles.length === 0) return;
    setMerging(true);
    try {
      const { PDFDocument } = libs.pdfLib;
      const merged = await PDFDocument.create();
      const sources = pdfBytes ? [{ name: file?.name || "current.pdf", data: pdfBytes }, ...mergeFiles] : mergeFiles;
      for (const src of sources) {
        try {
          const srcDoc = await PDFDocument.load(src.data, { ignoreEncryption: true });
          const pages = await merged.copyPages(srcDoc, srcDoc.getPageIndices());
          pages.forEach(p => merged.addPage(p));
        } catch { /* skip invalid */ }
      }
      const bytes = await merged.save();
      await openPDF(bytes.buffer, "merged.pdf");
      setShowMerge(false);
      dispatch({ type: "SET_MERGE_FILES", files: [] });
    } catch (e) {
      setError("Zusammenführung fehlgeschlagen: " + e.message);
    } finally { setMerging(false); }
  }, [libs.pdfLib, mergeFiles, pdfBytes, file, openPDF]);

  /* ─── Helpers ─── */
  function hexToRgb(hex) {
    const h = (hex || "#000000").replace("#", "");
    const bigint = parseInt(h.substring(0, 6), 16);
    return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
  }
  function parseAlpha(color) {
    if (!color) return 1;
    if (color.length === 9) return parseInt(color.substring(7, 9), 16) / 255;
    if (color.length === 5) return parseInt(color.substring(4, 5) + color.substring(4, 5), 16) / 255;
    return 1;
  }
  function downloadBytes(bytes, name) {
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }
  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  }

  /* ─── Annotation Rendering ─── */
  const renderAnnotation = useCallback((ann) => {
    const isSelected = selection.has(ann.id);
    const isEditing = editingTextId === ann.id;
    const style = {
      position: "absolute", left: ann.x, top: ann.y,
      width: ann.width, height: ann.height,
      transform: ann.rotation ? `rotate(${ann.rotation}deg)` : undefined,
      opacity: ann.opacity, cursor: tool === TOOLS.SELECT ? "move" : "default",
      zIndex: ann.zIndex || 1
    };

    const handleProps = (type) => ({
      onMouseDown: (e) => handleAnnotationMouseDown(e, ann, type),
      style: {
        position: "absolute", width: HANDLE_SIZE, height: HANDLE_SIZE,
        background: "#0066ff", border: "1px solid white", borderRadius: "50%",
        cursor: type === "rotate" ? "grab" : type + "-resize",
        zIndex: 9999
      }
    });

    const handles = isSelected && !isEditing ? (
      <>
        <div {...handleProps("nw")} style={{ ...handleProps("nw").style, top: -4, left: -4, cursor: "nw-resize" }} />
        <div {...handleProps("ne")} style={{ ...handleProps("ne").style, top: -4, right: -4, cursor: "ne-resize" }} />
        <div {...handleProps("sw")} style={{ ...handleProps("sw").style, bottom: -4, left: -4, cursor: "sw-resize" }} />
        <div {...handleProps("se")} style={{ ...handleProps("se").style, bottom: -4, right: -4, cursor: "se-resize" }} />
        <div {...handleProps("n")} style={{ ...handleProps("n").style, top: -4, left: "50%", marginLeft: -4, cursor: "n-resize" }} />
        <div {...handleProps("s")} style={{ ...handleProps("s").style, bottom: -4, left: "50%", marginLeft: -4, cursor: "s-resize" }} />
        <div {...handleProps("e")} style={{ ...handleProps("e").style, right: -4, top: "50%", marginTop: -4, cursor: "e-resize" }} />
        <div {...handleProps("w")} style={{ ...handleProps("w").style, left: -4, top: "50%", marginTop: -4, cursor: "w-resize" }} />
        <div {...handleProps("rotate")} style={{ ...handleProps("rotate").style, top: -24, left: "50%", marginLeft: -4, background: "#ff9900", cursor: "grab" }} />
      </>
    ) : null;

    const selectionBox = isSelected ? { outline: "2px dashed #0066ff", outlineOffset: 2 } : {};

    if (ann.type === "text") {
      return (
        <div key={ann.id} style={{ ...style, ...selectionBox, minHeight: 20 }}
          onMouseDown={(e) => { if (!isEditing) handleAnnotationMouseDown(e, ann, "move"); }}
          onDoubleClick={(e) => { e.stopPropagation(); dispatch({ type: "SET_EDITING_TEXT", id: ann.id }); dispatch({ type: "SET_SELECTION", selection: new Set([ann.id]) }); }}
        >
          {isEditing ? (
            <textarea
              autoFocus
              value={ann.text}
              onChange={(e) => dispatch({ type: "UPDATE_ANNOTATION", id: ann.id, changes: { text: e.target.value }, noHistory: true })}
              onBlur={() => dispatch({ type: "SET_EDITING_TEXT", id: null })}
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                width: "100%", height: "100%", border: "1px solid #0066ff", background: "rgba(255,255,255,0.95)",
                fontFamily: ann.fontFamily, fontSize: ann.fontSize, color: ann.fontColor,
                fontWeight: ann.bold ? "bold" : "normal", fontStyle: ann.italic ? "italic" : "normal",
                textDecoration: ann.underline ? "underline" : "none", textAlign: ann.align,
                resize: "both", padding: "2px 4px", outline: "none", minHeight: 24, overflow: "hidden"
              }}
              onKeyDown={(e) => e.stopPropagation()}
            />
          ) : (
            <div style={{
              width: "100%", height: "100%", fontFamily: ann.fontFamily, fontSize: ann.fontSize,
              color: ann.fontColor, fontWeight: ann.bold ? "bold" : "normal",
              fontStyle: ann.italic ? "italic" : "normal", textDecoration: ann.underline ? "underline" : "none",
              textAlign: ann.align, whiteSpace: "pre-wrap", wordBreak: "break-word", padding: "2px 4px",
              userSelect: "none", lineHeight: 1.3
            }}>
              {ann.text}
            </div>
          )}
          {handles}
        </div>
      );
    }

    if (ann.type === "image") {
      return (
        <div key={ann.id} style={{ ...style, ...selectionBox }}
          onMouseDown={(e) => handleAnnotationMouseDown(e, ann, "move")}>
          <img src={ann.src} alt="" draggable={false}
            style={{ width: "100%", height: "100%", objectFit: "fill", pointerEvents: "none" }} />
          {handles}
        </div>
      );
    }

    if (ann.type === "rectangle") {
      return (
        <div key={ann.id} style={{ ...style, ...selectionBox }}
          onMouseDown={(e) => handleAnnotationMouseDown(e, ann, "move")}>
          <svg width="100%" height="100%" viewBox={`0 0 ${ann.width} ${ann.height}`} preserveAspectRatio="none">
            <rect x={ann.strokeWidth / 2} y={ann.strokeWidth / 2} width={ann.width - ann.strokeWidth} height={ann.height - ann.strokeWidth}
              fill={ann.fill} stroke={ann.stroke} strokeWidth={ann.strokeWidth} />
          </svg>
          {handles}
        </div>
      );
    }

    if (ann.type === "circle") {
      return (
        <div key={ann.id} style={{ ...style, ...selectionBox }}
          onMouseDown={(e) => handleAnnotationMouseDown(e, ann, "move")}>
          <svg width="100%" height="100%" viewBox={`0 0 ${ann.width} ${ann.height}`} preserveAspectRatio="none">
            <ellipse cx={ann.width / 2} cy={ann.height / 2} rx={ann.width / 2 - ann.strokeWidth} ry={ann.height / 2 - ann.strokeWidth}
              fill={ann.fill} stroke={ann.stroke} strokeWidth={ann.strokeWidth} />
          </svg>
          {handles}
        </div>
      );
    }

    if (ann.type === "line") {
      return (
        <div key={ann.id} style={{ ...style, height: Math.max(ann.height, 20), ...selectionBox }}
          onMouseDown={(e) => handleAnnotationMouseDown(e, ann, "move")}>
          <svg width="100%" height="100%" viewBox={`0 0 ${ann.width} 20`} preserveAspectRatio="none">
            <line x1={0} y1={10} x2={ann.width} y2={10} stroke={ann.stroke} strokeWidth={ann.strokeWidth} />
          </svg>
          {handles}
        </div>
      );
    }

    if (ann.type === "arrow") {
      return (
        <div key={ann.id} style={{ ...style, height: Math.max(ann.height, 20), ...selectionBox }}
          onMouseDown={(e) => handleAnnotationMouseDown(e, ann, "move")}>
          <svg width="100%" height="100%" viewBox={`0 0 ${ann.width} 20`} preserveAspectRatio="none">
            <defs><marker id={`ah_${ann.id}`} markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill={ann.stroke} /></marker></defs>
            <line x1={0} y1={10} x2={ann.width - 10} y2={10} stroke={ann.stroke} strokeWidth={ann.strokeWidth} markerEnd={`url(#ah_${ann.id})`} />
          </svg>
          {handles}
        </div>
      );
    }

    if (ann.type === "star") {
      const pts = [];
      const cx = ann.width / 2, cy = ann.height / 2;
      const or = Math.min(cx, cy) - ann.strokeWidth, ir = or * 0.4;
      for (let i = 0; i < 10; i++) {
        const angle = (i * Math.PI / 5) - Math.PI / 2;
        const r = i % 2 === 0 ? or : ir;
        pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
      }
      return (
        <div key={ann.id} style={{ ...style, ...selectionBox }}
          onMouseDown={(e) => handleAnnotationMouseDown(e, ann, "move")}>
          <svg width="100%" height="100%" viewBox={`0 0 ${ann.width} ${ann.height}`} preserveAspectRatio="none">
            <polygon points={pts.join(" ")} fill={ann.fill} stroke={ann.stroke} strokeWidth={ann.strokeWidth} />
          </svg>
          {handles}
        </div>
      );
    }

    if (ann.type === "triangle") {
      const sw = ann.strokeWidth;
      return (
        <div key={ann.id} style={{ ...style, ...selectionBox }}
          onMouseDown={(e) => handleAnnotationMouseDown(e, ann, "move")}>
          <svg width="100%" height="100%" viewBox={`0 0 ${ann.width} ${ann.height}`} preserveAspectRatio="none">
            <polygon points={`${ann.width / 2},${sw} ${ann.width - sw},${ann.height - sw} ${sw},${ann.height - sw}`}
              fill={ann.fill} stroke={ann.stroke} strokeWidth={sw} />
          </svg>
          {handles}
        </div>
      );
    }

    return null;
  }, [selection, editingTextId, tool, handleAnnotationMouseDown]);

  /* ─── Properties Panel ─── */
  const PropertiesPanel = () => {
    if (!selectedAnnotation) return null;
    const ann = selectedAnnotation;
    const update = (changes) => dispatch({ type: "UPDATE_ANNOTATION", id: ann.id, changes });

    return (
      <div className="flex flex-col gap-3 p-3 text-xs overflow-y-auto" style={{ maxHeight: "calc(100vh - 120px)" }}>
        <div className="font-semibold text-gray-300 uppercase tracking-wider text-[10px]">
          {ann.type === "text" ? "Text" : ann.type === "image" ? "Bild" : "Form"} Eigenschaften
        </div>

        {/* Position / Size */}
        <div className="grid grid-cols-2 gap-2">
          <label className="text-gray-500">X <input type="number" value={Math.round(ann.x)} onChange={e => update({ x: +e.target.value })} className="w-full mt-0.5 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-gray-200" /></label>
          <label className="text-gray-500">Y <input type="number" value={Math.round(ann.y)} onChange={e => update({ y: +e.target.value })} className="w-full mt-0.5 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-gray-200" /></label>
          <label className="text-gray-500">B <input type="number" value={Math.round(ann.width)} onChange={e => update({ width: +e.target.value })} className="w-full mt-0.5 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-gray-200" /></label>
          <label className="text-gray-500">H <input type="number" value={Math.round(ann.height)} onChange={e => update({ height: +e.target.value })} className="w-full mt-0.5 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-gray-200" /></label>
        </div>

        {/* Rotation & Opacity */}
        <div className="grid grid-cols-2 gap-2">
          <label className="text-gray-500">Rotation <input type="number" value={Math.round(ann.rotation || 0)} onChange={e => update({ rotation: +e.target.value })} className="w-full mt-0.5 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-gray-200" /></label>
          <label className="text-gray-500">Opacity <input type="range" min="0" max="1" step="0.05" value={ann.opacity} onChange={e => update({ opacity: +e.target.value })} className="w-full mt-1" /></label>
        </div>

        {/* Text Properties */}
        {ann.type === "text" && (
          <>
            <div>
              <span className="text-gray-500">Schrift</span>
              <select value={ann.fontFamily} onChange={e => update({ fontFamily: e.target.value })}
                className="w-full mt-0.5 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-gray-200">
                {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="flex gap-2 items-center">
              <input type="number" value={ann.fontSize} onChange={e => update({ fontSize: +e.target.value })} min={8} max={120}
                className="w-16 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-gray-200" />
              <button onClick={() => update({ bold: !ann.bold })} className={`p-1 rounded ${ann.bold ? "bg-blue-600" : "bg-gray-800"}`}><Bold size={14} /></button>
              <button onClick={() => update({ italic: !ann.italic })} className={`p-1 rounded ${ann.italic ? "bg-blue-600" : "bg-gray-800"}`}><Italic size={14} /></button>
              <button onClick={() => update({ underline: !ann.underline })} className={`p-1 rounded ${ann.underline ? "bg-blue-600" : "bg-gray-800"}`}><Underline size={14} /></button>
            </div>
            <div className="flex gap-1">
              <button onClick={() => update({ align: "left" })} className={`p-1 rounded ${ann.align === "left" ? "bg-blue-600" : "bg-gray-800"}`}><AlignLeft size={14} /></button>
              <button onClick={() => update({ align: "center" })} className={`p-1 rounded ${ann.align === "center" ? "bg-blue-600" : "bg-gray-800"}`}><AlignCenter size={14} /></button>
              <button onClick={() => update({ align: "right" })} className={`p-1 rounded ${ann.align === "right" ? "bg-blue-600" : "bg-gray-800"}`}><AlignRight size={14} /></button>
            </div>
            <ColorPick label="Farbe" value={ann.fontColor} onChange={c => update({ fontColor: c })} />
          </>
        )}

        {/* Shape Properties */}
        {["rectangle", "circle", "star", "triangle"].includes(ann.type) && (
          <>
            <ColorPick label="Füllung" value={ann.fill?.substring(0, 7)} onChange={c => update({ fill: c + "55" })} />
            <ColorPick label="Rahmen" value={ann.stroke} onChange={c => update({ stroke: c })} />
            <label className="text-gray-500">Rahmenbreite
              <input type="range" min="0" max="10" step="0.5" value={ann.strokeWidth} onChange={e => update({ strokeWidth: +e.target.value })} className="w-full" />
            </label>
          </>
        )}

        {["line", "arrow"].includes(ann.type) && (
          <>
            <ColorPick label="Farbe" value={ann.stroke} onChange={c => update({ stroke: c })} />
            <label className="text-gray-500">Stärke
              <input type="range" min="1" max="10" step="0.5" value={ann.strokeWidth} onChange={e => update({ strokeWidth: +e.target.value })} className="w-full" />
            </label>
          </>
        )}

        {/* Z-Index controls */}
        <div className="flex gap-1 pt-2 border-t border-gray-700">
          <button onClick={() => dispatch({ type: "MOVE_ANNOTATION_Z", id: ann.id, dir: "up" })} className="flex-1 py-1 bg-gray-800 rounded text-gray-400 hover:bg-gray-700 flex items-center justify-center gap-1"><MoveUp size={12} /> Vorne</button>
          <button onClick={() => dispatch({ type: "MOVE_ANNOTATION_Z", id: ann.id, dir: "down" })} className="flex-1 py-1 bg-gray-800 rounded text-gray-400 hover:bg-gray-700 flex items-center justify-center gap-1"><MoveDown size={12} /> Hinten</button>
        </div>
        <button onClick={() => dispatch({ type: "DELETE_SELECTION" })} className="py-1.5 bg-red-900/40 text-red-400 rounded hover:bg-red-900/60 flex items-center justify-center gap-1"><Trash2 size={12} /> Löschen</button>
      </div>
    );
  };

  /* ─── Loading Screen ─── */
  if (loading) {
    return (
      <div className="h-screen w-full flex items-center justify-center" style={{ background: "#121220" }}>
        <div className="text-center">
          <Loader2 className="animate-spin mx-auto mb-3 text-blue-500" size={36} />
          <div className="text-gray-400 text-sm">Libraries werden geladen…</div>
        </div>
      </div>
    );
  }

  if (error && !pdfDoc) {
    return (
      <div className="h-screen w-full flex items-center justify-center" style={{ background: "#121220" }}>
        <div className="text-center max-w-md">
          <CircleAlert className="mx-auto mb-3 text-red-400" size={36} />
          <div className="text-red-400 text-sm mb-2">{error}</div>
          <button onClick={() => setError(null)} className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm">OK</button>
        </div>
      </div>
    );
  }

  /* ─── No File → Welcome Screen ─── */
  if (!pdfDoc) {
    return (
      <div className="h-screen w-full flex flex-col" style={{ background: "#121220", color: "#e0e0e0" }}>
        {/* Mini toolbar */}
        <div className="flex items-center h-11 px-3 gap-2 shrink-0" style={{ background: "#1e1e2e", borderBottom: "1px solid #2a2a3e" }}>
          <FileText size={18} className="text-blue-500" />
          <span className="text-sm font-semibold tracking-wide">Mini Acrobat</span>
        </div>
        <div className="flex-1 flex items-center justify-center" onDragOver={handleDragOver} onDrop={handleDrop}>
          <div className="text-center max-w-md">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #0066ff22, #9933ff22)", border: "1px solid #333" }}>
              <FileUp size={36} className="text-blue-400" />
            </div>
            <h2 className="text-xl font-semibold mb-2">PDF öffnen</h2>
            <p className="text-gray-500 text-sm mb-6">Wähle eine PDF-Datei oder ziehe sie hierher.</p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => fileInputRef.current?.click()}
                className="px-5 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{ background: "#0066ff", color: "white" }}>
                <span className="flex items-center gap-2"><Upload size={16} /> Datei öffnen</span>
              </button>
              <button onClick={() => { mergeInputRef.current?.click(); }}
                className="px-5 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{ background: "#2a2a3e", color: "#ccc", border: "1px solid #3a3a4e" }}>
                <span className="flex items-center gap-2"><GitMerge size={16} /> PDFs zusammenführen</span>
              </button>
            </div>
          </div>
        </div>
        <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleFileOpen} />
        <input ref={mergeInputRef} type="file" accept=".pdf" multiple className="hidden" onChange={handleMergeFiles} />
        <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />

        {/* Merge modal when opened from welcome */}
        {showMerge && <MergeModal />}
      </div>
    );
  }

  /* ─── Merge Modal ─── */
  function MergeModal() {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" onClick={() => setShowMerge(false)}>
        <div className="rounded-xl p-5 w-[480px] max-h-[80vh] overflow-y-auto" style={{ background: "#1e1e2e", border: "1px solid #333" }} onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-200">PDFs zusammenführen</h3>
            <button onClick={() => setShowMerge(false)} className="text-gray-500 hover:text-gray-300"><X size={18} /></button>
          </div>
          {mergeFiles.length === 0 && !pdfBytes ? (
            <div className="text-center py-8">
              <p className="text-gray-500 text-sm mb-3">Noch keine Dateien ausgewählt.</p>
              <button onClick={() => mergeInputRef.current?.click()} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg">Dateien hinzufügen</button>
            </div>
          ) : (
            <>
              <div className="space-y-2 mb-4">
                {pdfBytes && <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "#262640" }}><FileText size={14} className="text-blue-400" /><span className="text-sm text-gray-300 flex-1">{file?.name || "Aktuell geöffnet"}</span><span className="text-[10px] text-gray-500">{formatSize(pdfBytes.length)}</span></div>}
                {mergeFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "#262640" }}>
                    <GripVertical size={14} className="text-gray-600" />
                    <FileText size={14} className="text-blue-400" />
                    <span className="text-sm text-gray-300 flex-1">{f.name}</span>
                    <span className="text-[10px] text-gray-500">{formatSize(f.data.length)}</span>
                    <button onClick={() => dispatch({ type: "SET_MERGE_FILES", files: mergeFiles.filter((_, j) => j !== i) })} className="text-gray-600 hover:text-red-400"><X size={14} /></button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={() => mergeInputRef.current?.click()} className="flex-1 py-2 text-sm rounded-lg" style={{ background: "#2a2a3e", color: "#aaa" }}>+ Dateien</button>
                <button onClick={executeMerge} disabled={merging} className="flex-1 py-2 text-sm rounded-lg bg-blue-600 text-white flex items-center justify-center gap-2">
                  {merging ? <Loader2 className="animate-spin" size={14} /> : <GitMerge size={14} />} Zusammenführen
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  /* ─── Save Dialog ─── */
  function SaveDialog() {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" onClick={() => setShowSaveDialog(false)}>
        <div className="rounded-xl p-5 w-[380px]" style={{ background: "#1e1e2e", border: "1px solid #333" }} onClick={e => e.stopPropagation()}>
          <h3 className="font-semibold text-gray-200 mb-3">PDF speichern</h3>
          <label className="text-xs text-gray-500">Dateiname</label>
          <input value={saveName} onChange={e => setSaveName(e.target.value)}
            className="w-full mt-1 mb-4 px-3 py-2 rounded-lg text-sm text-gray-200 outline-none"
            style={{ background: "#262640", border: "1px solid #3a3a4e" }}
            onKeyDown={e => { if (e.key === "Enter") handleSave(); e.stopPropagation(); }}
          />
          <div className="flex gap-2">
            <button onClick={() => setShowSaveDialog(false)} className="flex-1 py-2 text-sm rounded-lg" style={{ background: "#2a2a3e", color: "#aaa" }}>Abbrechen</button>
            <button onClick={handleSave} disabled={saving} className="flex-1 py-2 text-sm rounded-lg bg-blue-600 text-white flex items-center justify-center gap-2">
              {saving ? <Loader2 className="animate-spin" size={14} /> : <Download size={14} />} Speichern
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ─── Main Layout ─── */
  return (
    <div className="h-screen w-full flex flex-col select-none" style={{ background: "#121220", color: "#e0e0e0", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", fontSize: 13 }}>
      {/* Hidden inputs */}
      <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleFileOpen} />
      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
      <input ref={mergeInputRef} type="file" accept=".pdf" multiple className="hidden" onChange={handleMergeFiles} />

      {/* ═══ TOOLBAR ═══ */}
      <div className="flex items-center h-11 px-2 gap-0.5 shrink-0 overflow-x-auto" style={{ background: "#1e1e2e", borderBottom: "1px solid #2a2a3e" }}>
        {/* File ops */}
        <TBtn icon={FileUp} onClick={() => fileInputRef.current?.click()} tip="Öffnen" shortcut="Ctrl+O" />
        <TBtn icon={Save} onClick={() => setShowSaveDialog(true)} tip="Speichern" shortcut="Ctrl+S" disabled={!pdfDoc} />
        <TBtn icon={Archive} onClick={handleCompress} tip="Komprimieren" disabled={!pdfDoc || compressing} />
        <TBtn icon={GitMerge} onClick={() => { setShowMerge(true); }} tip="Zusammenführen" />
        <div className="w-px h-6 mx-1" style={{ background: "#333" }} />

        {/* Tools */}
        <TBtn icon={MousePointer2} active={tool === TOOLS.SELECT} onClick={() => dispatch({ type: "SET_TOOL", tool: TOOLS.SELECT })} tip="Auswahl" shortcut="V" />
        <TBtn icon={Type} active={tool === TOOLS.TEXT} onClick={() => dispatch({ type: "SET_TOOL", tool: TOOLS.TEXT })} tip="Text" shortcut="T" />
        <TBtn icon={Image} active={tool === TOOLS.IMAGE} onClick={() => dispatch({ type: "SET_TOOL", tool: TOOLS.IMAGE })} tip="Bild einfügen" />
        <div className="w-px h-6 mx-1" style={{ background: "#333" }} />

        {/* Shapes */}
        <TBtn icon={Square} active={tool === TOOLS.RECT} onClick={() => dispatch({ type: "SET_TOOL", tool: TOOLS.RECT })} tip="Rechteck" />
        <TBtn icon={Circle} active={tool === TOOLS.CIRCLE} onClick={() => dispatch({ type: "SET_TOOL", tool: TOOLS.CIRCLE })} tip="Kreis" />
        <TBtn icon={Minus} active={tool === TOOLS.LINE} onClick={() => dispatch({ type: "SET_TOOL", tool: TOOLS.LINE })} tip="Linie" />
        <TBtn icon={ArrowRight} active={tool === TOOLS.ARROW} onClick={() => dispatch({ type: "SET_TOOL", tool: TOOLS.ARROW })} tip="Pfeil" />
        <TBtn icon={Star} active={tool === TOOLS.STAR} onClick={() => dispatch({ type: "SET_TOOL", tool: TOOLS.STAR })} tip="Stern" />
        <TBtn icon={Triangle} active={tool === TOOLS.TRIANGLE} onClick={() => dispatch({ type: "SET_TOOL", tool: TOOLS.TRIANGLE })} tip="Dreieck" />
        <div className="w-px h-6 mx-1" style={{ background: "#333" }} />

        {/* Zoom */}
        <TBtn icon={ZoomOut} onClick={() => dispatch({ type: "SET_ZOOM", zoom: zoom - 0.15 })} tip="Verkleinern" shortcut="Ctrl+-" />
        <span className="text-xs text-gray-400 w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
        <TBtn icon={ZoomIn} onClick={() => dispatch({ type: "SET_ZOOM", zoom: zoom + 0.15 })} tip="Vergrössern" shortcut="Ctrl++" />
        <TBtn icon={Maximize} onClick={() => dispatch({ type: "SET_ZOOM", zoom: 1, fitMode: "page" })} tip="Ganze Seite" shortcut="Ctrl+0" />
        <div className="w-px h-6 mx-1" style={{ background: "#333" }} />

        {/* Undo/Redo */}
        <TBtn icon={Undo2} onClick={() => dispatch({ type: "UNDO" })} disabled={state.history.past.length === 0} tip="Rückgängig" shortcut="Ctrl+Z" />
        <TBtn icon={Redo2} onClick={() => dispatch({ type: "REDO" })} disabled={state.history.future.length === 0} tip="Wiederherstellen" shortcut="Ctrl+Shift+Z" />
        <div className="w-px h-6 mx-1" style={{ background: "#333" }} />

        {/* Sidebar toggles */}
        <TBtn icon={ui.sidebarOpen ? PanelLeftClose : PanelLeftOpen} onClick={() => dispatch({ type: "SET_UI", ui: { sidebarOpen: !ui.sidebarOpen } })} tip="Seitenleiste" />
        <TBtn icon={ui.propsOpen ? PanelRightClose : PanelRightOpen} onClick={() => dispatch({ type: "SET_UI", ui: { propsOpen: !ui.propsOpen } })} tip="Eigenschaften" />

        {/* Spacer + compression result */}
        <div className="flex-1" />
        {ui.compressResult && (
          <div className="text-[10px] text-green-400 px-2 flex items-center gap-1.5">
            <Check size={12} />
            {formatSize(ui.compressResult.original)} → {formatSize(ui.compressResult.compressed)} ({ui.compressResult.savedPct}% gespart)
          </div>
        )}
      </div>

      {/* ═══ MAIN AREA ═══ */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Sidebar (Thumbnails) ── */}
        {ui.sidebarOpen && (
          <div className="shrink-0 overflow-y-auto" style={{ width: 140, background: "#181828", borderRight: "1px solid #2a2a3e" }}>
            <div className="p-2 space-y-2">
              {Array.from({ length: pageCount }, (_, i) => i + 1).map(pg => (
                <button key={pg} onClick={() => dispatch({ type: "SET_PAGE", page: pg })}
                  className={`w-full rounded-lg overflow-hidden transition-all ${pg === currentPage ? "ring-2 ring-blue-500" : "opacity-70 hover:opacity-100"}`}
                  style={{ background: "#222238" }}>
                  {thumbnails[pg] ? (
                    <img src={thumbnails[pg]} alt={`Seite ${pg}`} className="w-full" />
                  ) : (
                    <div className="aspect-[3/4] flex items-center justify-center text-gray-600 text-xs">
                      <Loader2 className="animate-spin" size={14} />
                    </div>
                  )}
                  <div className="text-[10px] text-gray-500 py-0.5">{pg}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Canvas Area ── */}
        <div ref={containerRef} className="flex-1 overflow-auto flex items-start justify-center p-6" style={{ background: "#0d0d1a" }}
          onClick={(e) => { if (e.target === containerRef.current) dispatch({ type: "SET_SELECTION", selection: new Set() }); }}
          onDragOver={handleDragOver} onDrop={handleDrop}>
          <div className="relative shadow-2xl" style={{ width: canvasDims.width || "auto", height: canvasDims.height || "auto" }}>
            <canvas ref={canvasRef} style={{ display: "block" }} />
            {/* Annotation Overlay */}
            <div ref={overlayRef} className="absolute inset-0" style={{ cursor: tool !== TOOLS.SELECT ? "crosshair" : "default" }}
              onClick={handleCanvasClick}>
              {currentAnnotations.map(renderAnnotation)}
            </div>
            {pageRendering && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
                <Loader2 className="animate-spin text-blue-400" size={24} />
              </div>
            )}
          </div>
        </div>

        {/* ── Properties Panel ── */}
        {ui.propsOpen && (
          <div className="shrink-0 overflow-y-auto" style={{ width: 220, background: "#181828", borderLeft: "1px solid #2a2a3e" }}>
            {selectedAnnotation ? <PropertiesPanel /> : (
              <div className="p-4 text-center text-gray-600 text-xs mt-8">Kein Element ausgewählt</div>
            )}
          </div>
        )}
      </div>

      {/* ═══ STATUS BAR ═══ */}
      <div className="flex items-center h-7 px-3 shrink-0 text-[11px] text-gray-500 gap-4" style={{ background: "#1a1a2e", borderTop: "1px solid #2a2a3e" }}>
        <span>Seite {currentPage} / {pageCount}</span>
        <div className="flex items-center gap-1">
          <button onClick={() => dispatch({ type: "SET_PAGE", page: currentPage - 1 })} disabled={currentPage <= 1} className="hover:text-gray-300 disabled:opacity-30"><ChevronLeft size={14} /></button>
          <button onClick={() => dispatch({ type: "SET_PAGE", page: currentPage + 1 })} disabled={currentPage >= pageCount} className="hover:text-gray-300 disabled:opacity-30"><ChevronRight size={14} /></button>
        </div>
        <span>{Math.round(zoom * 100)}%</span>
        {file && <span>{formatSize(pdfBytes?.length || file.size)}</span>}
        <div className="flex-1" />
        {selection.size > 0 && <span>{selection.size} Element{selection.size > 1 ? "e" : ""} ausgewählt</span>}
        <span className="text-gray-600">Mini Acrobat</span>
      </div>

      {/* ═══ MODALS ═══ */}
      {showSaveDialog && <SaveDialog />}
      {showMerge && <MergeModal />}
      {error && pdfDoc && (
        <div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-[9999] px-4 py-2 rounded-lg text-sm flex items-center gap-2" style={{ background: "#ff333322", border: "1px solid #ff3333", color: "#ff6666" }}>
          <CircleAlert size={14} />{error}
          <button onClick={() => setError(null)} className="ml-2 text-gray-400 hover:text-white"><X size={14} /></button>
        </div>
      )}
    </div>
  );
}
