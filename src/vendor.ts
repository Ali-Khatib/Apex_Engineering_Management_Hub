// Markdown rendering + sanitising, exposed as globals for ui.tsx (renderMd).
import { marked } from "marked";
import DOMPurify from "dompurify";
Object.assign(window as any, { marked, DOMPurify });
