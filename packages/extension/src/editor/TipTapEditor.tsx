import { marked } from "marked";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { Article } from "./EditorApp";

interface TipTapEditorProps {
  article: Article;
  onChange: (content: string) => void;
  onEditorReady?: (editor: any) => void;
}

export function TipTapEditor({
  article,
  onChange,
  onEditorReady,
}: TipTapEditorProps) {
  console.log("TipTapEditor - article.content:", article.content);
  console.log("TipTapEditor - content type:", typeof article.content);

  // 转换包含 Markdown 的 HTML 内容
  let content = article.content || "";

  // 如果内容包含 Markdown 语法，进行转换
  if (
    content.includes("#") ||
    content.includes("**") ||
    content.includes("* ") ||
    content.includes("1. ")
  ) {
    // 提取 HTML 标签中的文本内容
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = content;
    const textContent = tempDiv.textContent || tempDiv.innerText || "";

    // 将纯文本 Markdown 转换为 HTML
    if (textContent.includes("#") || textContent.includes("**")) {
      content = marked.parse(textContent) as string;
    }
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4, 5, 6],
        },
        bulletList: {
          HTMLAttributes: {
            class: "list-disc pl-8 mb-4",
          },
        },
        orderedList: {
          HTMLAttributes: {
            class: "list-decimal pl-8 mb-4",
          },
        },
        listItem: {
          HTMLAttributes: {
            class: "mb-2",
          },
        },
        paragraph: {
          HTMLAttributes: {
            class: "mb-4",
          },
        },
      }),
      Underline,
      Link.configure({
        HTMLAttributes: {
          class: "text-blue-600 hover:underline",
        },
      }),
      Image.configure({
        HTMLAttributes: {
          class: "max-w-full h-auto my-4 rounded-lg shadow-md",
        },
      }),
    ],
    onCreate: (props) => {
      console.log("TipTapEditor - onCreate called, editor:", props.editor);
      if (onEditorReady) {
        onEditorReady(props.editor);
      }
    },
    content: content,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: "prose prose-lg max-w-none outline-none",
        style:
          "font-size: 16px; line-height: 1.8; color: #333; letter-spacing: 0.5px; min-height: 800px; outline: none; border: none; box-shadow: none;",
      },
    },
  });

  return (
    <div
      className="prose prose-lg max-w-none"
      style={{
        minHeight: "800px",
        lineHeight: 1.8,
        color: "#333",
        letterSpacing: "0.5px",
      }}
    >
      <EditorContent
        editor={editor}
        style={{
          outline: "none !important",
          border: "none !important",
          boxShadow: "none !important",
          borderWidth: 0,
          borderStyle: "none",
          borderColor: "transparent",
          borderRadius: 0,
        }}
      />
    </div>
  );
}
