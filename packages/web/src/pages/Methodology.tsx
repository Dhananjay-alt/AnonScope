import { useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { marked } from "marked";
import md from "../../../../docs/methodology.md?raw";

function slug(s: string): string {
  return s.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function Methodology() {
  const html = useMemo(() => {
    const renderer = new marked.Renderer();
    renderer.heading = ({ tokens, depth }) => {
      const text = renderer.parser.parseInline(tokens);
      return `<h${depth} id="${slug(text)}">${text}</h${depth}>`;
    };
    // Our own markdown, bundled at build time: not user input.
    return marked.parse(md, { renderer, async: false }) as string;
  }, []);
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash, html]);
  return <article className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
