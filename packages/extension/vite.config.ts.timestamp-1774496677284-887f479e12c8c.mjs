// vite.config.ts
import { defineConfig, loadEnv } from "file:///D:/Atopos/software_project/vscode_project/GitHub/Wechatsync/node_modules/.pnpm/vite@5.4.21_@types+node@22.19.7/node_modules/vite/dist/node/index.js";
import react from "file:///D:/Atopos/software_project/vscode_project/GitHub/Wechatsync/node_modules/.pnpm/@vitejs+plugin-react@4.7.0_vite@5.4.21_@types+node@22.19.7_/node_modules/@vitejs/plugin-react/dist/index.js";
import { crx } from "file:///D:/Atopos/software_project/vscode_project/GitHub/Wechatsync/node_modules/.pnpm/@crxjs+vite-plugin@2.3.0/node_modules/@crxjs/vite-plugin/dist/index.mjs";
import yaml from "file:///D:/Atopos/software_project/vscode_project/GitHub/Wechatsync/node_modules/.pnpm/@modyfi+vite-plugin-yaml@1._3418c5066becef1376120fca7f28b67c/node_modules/@modyfi/vite-plugin-yaml/dist/index.js";
import { resolve } from "path";
import { copyFileSync, mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync } from "fs";

// manifest.json
var manifest_default = {
  manifest_version: 3,
  name: "\u6587\u7AE0\u540C\u6B65\u52A9\u624B",
  description: "\u4E00\u952E\u540C\u6B65\u6587\u7AE0\u5230\u77E5\u4E4E\u3001\u5934\u6761\u3001\u6398\u91D1\u7B49 20+ \u5E73\u53F0\uFF0C\u652F\u6301 WordPress \u7B49\u81EA\u5EFA\u7AD9",
  version: "2.0.7",
  icons: {
    "16": "assets/icon-16.png",
    "48": "assets/icon-48.png",
    "128": "assets/icon-128.png"
  },
  action: {
    default_icon: "assets/icon-48.png",
    default_popup: "src/popup/index.html"
  },
  permissions: [
    "storage",
    "unlimitedStorage",
    "cookies",
    "declarativeNetRequest",
    "declarativeNetRequestWithHostAccess",
    "scripting",
    "tabs",
    "alarms",
    "contextMenus",
    "downloads"
  ],
  host_permissions: [
    "http://*/*",
    "https://*/*"
  ],
  background: {
    service_worker: "src/background/index.ts",
    type: "module"
  },
  content_scripts: [
    {
      matches: ["http://*/*", "https://*/*"],
      js: ["src/content/api.ts"],
      run_at: "document_start",
      all_frames: true
    },
    {
      matches: ["https://mp.weixin.qq.com/s/*", "https://mp.weixin.qq.com/s?*"],
      js: ["src/content/weixin.ts"],
      run_at: "document_end"
    },
    {
      matches: ["https://mp.weixin.qq.com/cgi-bin/appmsg*"],
      js: ["src/content/weixin-editor.ts"],
      run_at: "document_end"
    },
    {
      matches: ["https://mp.toutiao.com/*"],
      js: ["src/content/toutiao.ts"],
      run_at: "document_end"
    },
    {
      matches: ["http://*/*", "https://*/*"],
      js: [
        "src/content/extractor.ts"
      ],
      run_at: "document_end"
    }
  ],
  web_accessible_resources: [
    {
      resources: ["assets/*", "src/editor/index.html", "inject-api.js"],
      matches: ["<all_urls>"]
    }
  ]
};

// vite.config.ts
var __vite_injected_original_dirname = "D:\\Atopos\\software_project\\vscode_project\\GitHub\\Wechatsync\\packages\\extension";
var privateContentScripts = [];
var privateScriptConfigs = [
  { file: "src/content/xiaohongshu.ts", matches: ["https://creator.xiaohongshu.com/*"], run_at: "document_end" }
];
for (const config of privateScriptConfigs) {
  if (existsSync(resolve(__vite_injected_original_dirname, config.file))) {
    privateContentScripts.push({ matches: config.matches, js: [config.file], run_at: config.run_at });
  }
}
var manifest = {
  ...manifest_default,
  content_scripts: [...manifest_default.content_scripts, ...privateContentScripts]
};
function copyStaticFilesPlugin() {
  return {
    name: "copy-static-files",
    writeBundle() {
      const rulesDir = resolve(__vite_injected_original_dirname, "rules");
      const distRulesDir = resolve(__vite_injected_original_dirname, "dist/rules");
      if (existsSync(rulesDir)) {
        if (!existsSync(distRulesDir)) {
          mkdirSync(distRulesDir, { recursive: true });
        }
        const files = readdirSync(rulesDir);
        for (const file of files) {
          copyFileSync(
            resolve(rulesDir, file),
            resolve(distRulesDir, file)
          );
          console.log(`[copy-static] Copied rules/${file}`);
        }
      }
      const readerDir = resolve(__vite_injected_original_dirname, "public/lib");
      const distDir = resolve(__vite_injected_original_dirname, "dist");
      if (existsSync(readerDir)) {
        const readerFiles = ["reader.js", "Readability.js"];
        for (const file of readerFiles) {
          const srcPath = resolve(readerDir, file);
          const destPath = resolve(distDir, file);
          if (existsSync(srcPath)) {
            copyFileSync(srcPath, destPath);
            console.log(`[copy-static] Copied ${file} to dist/`);
          }
        }
      }
      const manifestPath = resolve(__vite_injected_original_dirname, "dist/manifest.json");
      if (existsSync(manifestPath)) {
        const manifestContent = JSON.parse(readFileSync(manifestPath, "utf-8"));
        const readerContentScript = {
          js: ["reader.js", "Readability.js"],
          matches: ["http://*/*", "https://*/*"],
          run_at: "document_start"
        };
        manifestContent.content_scripts = [
          readerContentScript,
          ...manifestContent.content_scripts
        ];
        writeFileSync(manifestPath, JSON.stringify(manifestContent, null, 2));
        console.log("[copy-static] Updated manifest.json with reader scripts");
      }
    }
  };
}
var vite_config_default = defineConfig(({ mode }) => {
  const env = loadEnv(mode, __vite_injected_original_dirname, "");
  const isDev = mode === "development";
  return {
    plugins: [
      react(),
      yaml(),
      crx({ manifest }),
      copyStaticFilesPlugin()
    ],
    define: {
      "import.meta.env.VITE_GA_MEASUREMENT_ID": JSON.stringify(env.VITE_GA_MEASUREMENT_ID || ""),
      "import.meta.env.VITE_GA_API_SECRET": JSON.stringify(env.VITE_GA_API_SECRET || ""),
      // 开发模式下覆盖 PROD 标志，让 logger 输出 debug 日志
      "import.meta.env.PROD": JSON.stringify(!isDev),
      "import.meta.env.DEV": JSON.stringify(isDev)
    },
    resolve: {
      alias: {
        "@": resolve(__vite_injected_original_dirname, "src"),
        "@wechatsync/core": resolve(__vite_injected_original_dirname, "../core/src")
      }
    },
    build: {
      // 开发模式: 不压缩，生成 sourcemap
      minify: isDev ? false : "esbuild",
      sourcemap: isDev ? "inline" : false,
      rollupOptions: {
        input: {
          popup: resolve(__vite_injected_original_dirname, "src/popup/index.html"),
          editor: resolve(__vite_injected_original_dirname, "src/editor/index.html")
        }
      }
    }
  };
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiLCAibWFuaWZlc3QuanNvbiJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIkQ6XFxcXEF0b3Bvc1xcXFxzb2Z0d2FyZV9wcm9qZWN0XFxcXHZzY29kZV9wcm9qZWN0XFxcXEdpdEh1YlxcXFxXZWNoYXRzeW5jXFxcXHBhY2thZ2VzXFxcXGV4dGVuc2lvblwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiRDpcXFxcQXRvcG9zXFxcXHNvZnR3YXJlX3Byb2plY3RcXFxcdnNjb2RlX3Byb2plY3RcXFxcR2l0SHViXFxcXFdlY2hhdHN5bmNcXFxccGFja2FnZXNcXFxcZXh0ZW5zaW9uXFxcXHZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9EOi9BdG9wb3Mvc29mdHdhcmVfcHJvamVjdC92c2NvZGVfcHJvamVjdC9HaXRIdWIvV2VjaGF0c3luYy9wYWNrYWdlcy9leHRlbnNpb24vdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcsIGxvYWRFbnYgfSBmcm9tICd2aXRlJ1xyXG5pbXBvcnQgcmVhY3QgZnJvbSAnQHZpdGVqcy9wbHVnaW4tcmVhY3QnXHJcbmltcG9ydCB7IGNyeCB9IGZyb20gJ0Bjcnhqcy92aXRlLXBsdWdpbidcclxuaW1wb3J0IHlhbWwgZnJvbSAnQG1vZHlmaS92aXRlLXBsdWdpbi15YW1sJ1xyXG5pbXBvcnQgeyByZXNvbHZlIH0gZnJvbSAncGF0aCdcclxuaW1wb3J0IHsgY29weUZpbGVTeW5jLCBta2RpclN5bmMsIGV4aXN0c1N5bmMsIHJlYWRkaXJTeW5jLCByZWFkRmlsZVN5bmMsIHdyaXRlRmlsZVN5bmMgfSBmcm9tICdmcydcclxuaW1wb3J0IGJhc2VNYW5pZmVzdCBmcm9tICcuL21hbmlmZXN0Lmpzb24nXHJcblxyXG4vLyBcdTUyQThcdTYwMDFcdTZERkJcdTUyQTBcdTc5QzFcdTY3MDkgY29udGVudCBzY3JpcHRzXHVGRjA4XHU2NTg3XHU0RUY2XHU1QjU4XHU1NzI4XHU2NUY2XHU2MjREXHU2Q0U4XHU1MTY1XHVGRjA5XHJcbmNvbnN0IHByaXZhdGVDb250ZW50U2NyaXB0czogQXJyYXk8eyBtYXRjaGVzOiBzdHJpbmdbXTsganM6IHN0cmluZ1tdOyBydW5fYXQ6IHN0cmluZyB9PiA9IFtdXHJcbmNvbnN0IHByaXZhdGVTY3JpcHRDb25maWdzID0gW1xyXG4gIHsgZmlsZTogJ3NyYy9jb250ZW50L3hpYW9ob25nc2h1LnRzJywgbWF0Y2hlczogWydodHRwczovL2NyZWF0b3IueGlhb2hvbmdzaHUuY29tLyonXSwgcnVuX2F0OiAnZG9jdW1lbnRfZW5kJyB9LFxyXG5dXHJcbmZvciAoY29uc3QgY29uZmlnIG9mIHByaXZhdGVTY3JpcHRDb25maWdzKSB7XHJcbiAgaWYgKGV4aXN0c1N5bmMocmVzb2x2ZShfX2Rpcm5hbWUsIGNvbmZpZy5maWxlKSkpIHtcclxuICAgIHByaXZhdGVDb250ZW50U2NyaXB0cy5wdXNoKHsgbWF0Y2hlczogY29uZmlnLm1hdGNoZXMsIGpzOiBbY29uZmlnLmZpbGVdLCBydW5fYXQ6IGNvbmZpZy5ydW5fYXQgfSlcclxuICB9XHJcbn1cclxuY29uc3QgbWFuaWZlc3QgPSB7XHJcbiAgLi4uYmFzZU1hbmlmZXN0LFxyXG4gIGNvbnRlbnRfc2NyaXB0czogWy4uLmJhc2VNYW5pZmVzdC5jb250ZW50X3NjcmlwdHMsIC4uLnByaXZhdGVDb250ZW50U2NyaXB0c10sXHJcbn1cclxuXHJcbi8vIFx1NTkwRFx1NTIzNlx1OTc1OVx1NjAwMVx1NjU4N1x1NEVGNlx1NUU3Nlx1NEZFRVx1NjUzOSBtYW5pZmVzdCBcdTc2ODRcdTYzRDJcdTRFRjZcclxuZnVuY3Rpb24gY29weVN0YXRpY0ZpbGVzUGx1Z2luKCkge1xyXG4gIHJldHVybiB7XHJcbiAgICBuYW1lOiAnY29weS1zdGF0aWMtZmlsZXMnLFxyXG4gICAgd3JpdGVCdW5kbGUoKSB7XHJcblxyXG4gICAgICAvLyBcdTU5MERcdTUyMzYgcnVsZXMgXHU3NkVFXHU1RjU1XHJcbiAgICAgIGNvbnN0IHJ1bGVzRGlyID0gcmVzb2x2ZShfX2Rpcm5hbWUsICdydWxlcycpXHJcbiAgICAgIGNvbnN0IGRpc3RSdWxlc0RpciA9IHJlc29sdmUoX19kaXJuYW1lLCAnZGlzdC9ydWxlcycpXHJcblxyXG4gICAgICBpZiAoZXhpc3RzU3luYyhydWxlc0RpcikpIHtcclxuICAgICAgICBpZiAoIWV4aXN0c1N5bmMoZGlzdFJ1bGVzRGlyKSkge1xyXG4gICAgICAgICAgbWtkaXJTeW5jKGRpc3RSdWxlc0RpciwgeyByZWN1cnNpdmU6IHRydWUgfSlcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGZpbGVzID0gcmVhZGRpclN5bmMocnVsZXNEaXIpXHJcbiAgICAgICAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XHJcbiAgICAgICAgICBjb3B5RmlsZVN5bmMoXHJcbiAgICAgICAgICAgIHJlc29sdmUocnVsZXNEaXIsIGZpbGUpLFxyXG4gICAgICAgICAgICByZXNvbHZlKGRpc3RSdWxlc0RpciwgZmlsZSlcclxuICAgICAgICAgIClcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGBbY29weS1zdGF0aWNdIENvcGllZCBydWxlcy8ke2ZpbGV9YClcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIFx1NTkwRFx1NTIzNiByZWFkZXIgXHU4MTFBXHU2NzJDXHVGRjA4XHU5MDdGXHU1MTREXHU4OEFCIHZpdGUgXHU4RjZDXHU2MzYyXHU0RTNBIEVTIG1vZHVsZXNcdUZGMDlcclxuICAgICAgY29uc3QgcmVhZGVyRGlyID0gcmVzb2x2ZShfX2Rpcm5hbWUsICdwdWJsaWMvbGliJylcclxuICAgICAgY29uc3QgZGlzdERpciA9IHJlc29sdmUoX19kaXJuYW1lLCAnZGlzdCcpXHJcblxyXG4gICAgICBpZiAoZXhpc3RzU3luYyhyZWFkZXJEaXIpKSB7XHJcbiAgICAgICAgY29uc3QgcmVhZGVyRmlsZXMgPSBbJ3JlYWRlci5qcycsICdSZWFkYWJpbGl0eS5qcyddXHJcbiAgICAgICAgZm9yIChjb25zdCBmaWxlIG9mIHJlYWRlckZpbGVzKSB7XHJcbiAgICAgICAgICBjb25zdCBzcmNQYXRoID0gcmVzb2x2ZShyZWFkZXJEaXIsIGZpbGUpXHJcbiAgICAgICAgICBjb25zdCBkZXN0UGF0aCA9IHJlc29sdmUoZGlzdERpciwgZmlsZSlcclxuICAgICAgICAgIGlmIChleGlzdHNTeW5jKHNyY1BhdGgpKSB7XHJcbiAgICAgICAgICAgIGNvcHlGaWxlU3luYyhzcmNQYXRoLCBkZXN0UGF0aClcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtjb3B5LXN0YXRpY10gQ29waWVkICR7ZmlsZX0gdG8gZGlzdC9gKVxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gXHU0RkVFXHU2NTM5XHU4RjkzXHU1MUZBXHU3Njg0IG1hbmlmZXN0Lmpzb25cdUZGMENcdTZERkJcdTUyQTAgcmVhZGVyIFx1ODExQVx1NjcyQ1x1NTIzMCBjb250ZW50X3NjcmlwdHNcclxuICAgICAgY29uc3QgbWFuaWZlc3RQYXRoID0gcmVzb2x2ZShfX2Rpcm5hbWUsICdkaXN0L21hbmlmZXN0Lmpzb24nKVxyXG4gICAgICBpZiAoZXhpc3RzU3luYyhtYW5pZmVzdFBhdGgpKSB7XHJcbiAgICAgICAgY29uc3QgbWFuaWZlc3RDb250ZW50ID0gSlNPTi5wYXJzZShyZWFkRmlsZVN5bmMobWFuaWZlc3RQYXRoLCAndXRmLTgnKSlcclxuXHJcbiAgICAgICAgLy8gXHU1NzI4IGNvbnRlbnRfc2NyaXB0cyBcdTVGMDBcdTU5MzRcdTZERkJcdTUyQTAgcmVhZGVyIFx1ODExQVx1NjcyQ1xyXG4gICAgICAgIC8vIFx1NEUwRFx1OEJCRVx1N0Y2RSB3b3JsZFx1RkYwQ1x1NEY3Rlx1NzUyOFx1OUVEOFx1OEJBNFx1NzY4NCBJU09MQVRFRCB3b3JsZFx1RkYwQ1x1NEUwRSBleHRyYWN0b3IgXHU1MTcxXHU0RUFCXHU1MTY4XHU1QzQwXHU1M0Q4XHU5MUNGXHJcbiAgICAgICAgY29uc3QgcmVhZGVyQ29udGVudFNjcmlwdCA9IHtcclxuICAgICAgICAgIGpzOiBbJ3JlYWRlci5qcycsICdSZWFkYWJpbGl0eS5qcyddLFxyXG4gICAgICAgICAgbWF0Y2hlczogWydodHRwOi8vKi8qJywgJ2h0dHBzOi8vKi8qJ10sXHJcbiAgICAgICAgICBydW5fYXQ6ICdkb2N1bWVudF9zdGFydCdcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIFx1NkRGQlx1NTJBMFx1NTIzMCBjb250ZW50X3NjcmlwdHMgXHU2NTcwXHU3RUM0XHU1RjAwXHU1OTM0XHJcbiAgICAgICAgbWFuaWZlc3RDb250ZW50LmNvbnRlbnRfc2NyaXB0cyA9IFtcclxuICAgICAgICAgIHJlYWRlckNvbnRlbnRTY3JpcHQsXHJcbiAgICAgICAgICAuLi5tYW5pZmVzdENvbnRlbnQuY29udGVudF9zY3JpcHRzXHJcbiAgICAgICAgXVxyXG5cclxuICAgICAgICB3cml0ZUZpbGVTeW5jKG1hbmlmZXN0UGF0aCwgSlNPTi5zdHJpbmdpZnkobWFuaWZlc3RDb250ZW50LCBudWxsLCAyKSlcclxuICAgICAgICBjb25zb2xlLmxvZygnW2NvcHktc3RhdGljXSBVcGRhdGVkIG1hbmlmZXN0Lmpzb24gd2l0aCByZWFkZXIgc2NyaXB0cycpXHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcbn1cclxuXHJcbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZygoeyBtb2RlIH0pID0+IHtcclxuICBjb25zdCBlbnYgPSBsb2FkRW52KG1vZGUsIF9fZGlybmFtZSwgJycpXHJcbiAgY29uc3QgaXNEZXYgPSBtb2RlID09PSAnZGV2ZWxvcG1lbnQnXHJcbiAgcmV0dXJuIHtcclxuICAgIHBsdWdpbnM6IFtcclxuICAgICAgcmVhY3QoKSxcclxuICAgICAgeWFtbCgpLFxyXG4gICAgICBjcngoeyBtYW5pZmVzdCB9KSxcclxuICAgICAgY29weVN0YXRpY0ZpbGVzUGx1Z2luKCksXHJcbiAgICBdLFxyXG4gICAgZGVmaW5lOiB7XHJcbiAgICAgICdpbXBvcnQubWV0YS5lbnYuVklURV9HQV9NRUFTVVJFTUVOVF9JRCc6IEpTT04uc3RyaW5naWZ5KGVudi5WSVRFX0dBX01FQVNVUkVNRU5UX0lEIHx8ICcnKSxcclxuICAgICAgJ2ltcG9ydC5tZXRhLmVudi5WSVRFX0dBX0FQSV9TRUNSRVQnOiBKU09OLnN0cmluZ2lmeShlbnYuVklURV9HQV9BUElfU0VDUkVUIHx8ICcnKSxcclxuICAgICAgLy8gXHU1RjAwXHU1M0QxXHU2QTIxXHU1RjBGXHU0RTBCXHU4OTg2XHU3NkQ2IFBST0QgXHU2ODA3XHU1RkQ3XHVGRjBDXHU4QkE5IGxvZ2dlciBcdThGOTNcdTUxRkEgZGVidWcgXHU2NUU1XHU1RkQ3XHJcbiAgICAgICdpbXBvcnQubWV0YS5lbnYuUFJPRCc6IEpTT04uc3RyaW5naWZ5KCFpc0RldiksXHJcbiAgICAgICdpbXBvcnQubWV0YS5lbnYuREVWJzogSlNPTi5zdHJpbmdpZnkoaXNEZXYpLFxyXG4gICAgfSxcclxuICByZXNvbHZlOiB7XHJcbiAgICBhbGlhczoge1xyXG4gICAgICAnQCc6IHJlc29sdmUoX19kaXJuYW1lLCAnc3JjJyksXHJcbiAgICAgICdAd2VjaGF0c3luYy9jb3JlJzogcmVzb2x2ZShfX2Rpcm5hbWUsICcuLi9jb3JlL3NyYycpLFxyXG4gICAgfSxcclxuICB9LFxyXG4gIGJ1aWxkOiB7XHJcbiAgICAvLyBcdTVGMDBcdTUzRDFcdTZBMjFcdTVGMEY6IFx1NEUwRFx1NTM4Qlx1N0YyOVx1RkYwQ1x1NzUxRlx1NjIxMCBzb3VyY2VtYXBcclxuICAgIG1pbmlmeTogaXNEZXYgPyBmYWxzZSA6ICdlc2J1aWxkJyxcclxuICAgIHNvdXJjZW1hcDogaXNEZXYgPyAnaW5saW5lJyA6IGZhbHNlLFxyXG4gICAgcm9sbHVwT3B0aW9uczoge1xyXG4gICAgICBpbnB1dDoge1xyXG4gICAgICAgIHBvcHVwOiByZXNvbHZlKF9fZGlybmFtZSwgJ3NyYy9wb3B1cC9pbmRleC5odG1sJyksXHJcbiAgICAgICAgZWRpdG9yOiByZXNvbHZlKF9fZGlybmFtZSwgJ3NyYy9lZGl0b3IvaW5kZXguaHRtbCcpLFxyXG4gICAgICB9LFxyXG4gICAgfSxcclxuICB9LFxyXG59fSlcclxuIiwgIntcclxuICBcIm1hbmlmZXN0X3ZlcnNpb25cIjogMyxcclxuICBcIm5hbWVcIjogXCJcdTY1ODdcdTdBRTBcdTU0MENcdTZCNjVcdTUyQTlcdTYyNEJcIixcclxuICBcImRlc2NyaXB0aW9uXCI6IFwiXHU0RTAwXHU5NTJFXHU1NDBDXHU2QjY1XHU2NTg3XHU3QUUwXHU1MjMwXHU3N0U1XHU0RTRFXHUzMDAxXHU1OTM0XHU2NzYxXHUzMDAxXHU2Mzk4XHU5MUQxXHU3QjQ5IDIwKyBcdTVFNzNcdTUzRjBcdUZGMENcdTY1MkZcdTYzMDEgV29yZFByZXNzIFx1N0I0OVx1ODFFQVx1NUVGQVx1N0FEOVwiLFxyXG4gIFwidmVyc2lvblwiOiBcIjIuMC43XCIsXHJcbiAgXCJpY29uc1wiOiB7XHJcbiAgICBcIjE2XCI6IFwiYXNzZXRzL2ljb24tMTYucG5nXCIsXHJcbiAgICBcIjQ4XCI6IFwiYXNzZXRzL2ljb24tNDgucG5nXCIsXHJcbiAgICBcIjEyOFwiOiBcImFzc2V0cy9pY29uLTEyOC5wbmdcIlxyXG4gIH0sXHJcbiAgXCJhY3Rpb25cIjoge1xyXG4gICAgXCJkZWZhdWx0X2ljb25cIjogXCJhc3NldHMvaWNvbi00OC5wbmdcIixcclxuICAgIFwiZGVmYXVsdF9wb3B1cFwiOiBcInNyYy9wb3B1cC9pbmRleC5odG1sXCJcclxuICB9LFxyXG4gIFwicGVybWlzc2lvbnNcIjogW1xyXG4gICAgXCJzdG9yYWdlXCIsXHJcbiAgICBcInVubGltaXRlZFN0b3JhZ2VcIixcclxuICAgIFwiY29va2llc1wiLFxyXG4gICAgXCJkZWNsYXJhdGl2ZU5ldFJlcXVlc3RcIixcclxuICAgIFwiZGVjbGFyYXRpdmVOZXRSZXF1ZXN0V2l0aEhvc3RBY2Nlc3NcIixcclxuICAgIFwic2NyaXB0aW5nXCIsXHJcbiAgICBcInRhYnNcIixcclxuICAgIFwiYWxhcm1zXCIsXHJcbiAgICBcImNvbnRleHRNZW51c1wiLFxyXG4gICAgXCJkb3dubG9hZHNcIlxyXG4gIF0sXHJcbiAgXCJob3N0X3Blcm1pc3Npb25zXCI6IFtcclxuICAgIFwiaHR0cDovLyovKlwiLFxyXG4gICAgXCJodHRwczovLyovKlwiXHJcbiAgXSxcclxuICBcImJhY2tncm91bmRcIjoge1xyXG4gICAgXCJzZXJ2aWNlX3dvcmtlclwiOiBcInNyYy9iYWNrZ3JvdW5kL2luZGV4LnRzXCIsXHJcbiAgICBcInR5cGVcIjogXCJtb2R1bGVcIlxyXG4gIH0sXHJcbiAgXCJjb250ZW50X3NjcmlwdHNcIjogW1xyXG4gICAge1xyXG4gICAgICBcIm1hdGNoZXNcIjogW1wiaHR0cDovLyovKlwiLCBcImh0dHBzOi8vKi8qXCJdLFxyXG4gICAgICBcImpzXCI6IFtcInNyYy9jb250ZW50L2FwaS50c1wiXSxcclxuICAgICAgXCJydW5fYXRcIjogXCJkb2N1bWVudF9zdGFydFwiLFxyXG4gICAgICBcImFsbF9mcmFtZXNcIjogdHJ1ZVxyXG4gICAgfSxcclxuICAgIHtcclxuICAgICAgXCJtYXRjaGVzXCI6IFtcImh0dHBzOi8vbXAud2VpeGluLnFxLmNvbS9zLypcIiwgXCJodHRwczovL21wLndlaXhpbi5xcS5jb20vcz8qXCJdLFxyXG4gICAgICBcImpzXCI6IFtcInNyYy9jb250ZW50L3dlaXhpbi50c1wiXSxcclxuICAgICAgXCJydW5fYXRcIjogXCJkb2N1bWVudF9lbmRcIlxyXG4gICAgfSxcclxuICAgIHtcclxuICAgICAgXCJtYXRjaGVzXCI6IFtcImh0dHBzOi8vbXAud2VpeGluLnFxLmNvbS9jZ2ktYmluL2FwcG1zZypcIl0sXHJcbiAgICAgIFwianNcIjogW1wic3JjL2NvbnRlbnQvd2VpeGluLWVkaXRvci50c1wiXSxcclxuICAgICAgXCJydW5fYXRcIjogXCJkb2N1bWVudF9lbmRcIlxyXG4gICAgfSxcclxuICAgIHtcclxuICAgICAgXCJtYXRjaGVzXCI6IFtcImh0dHBzOi8vbXAudG91dGlhby5jb20vKlwiXSxcclxuICAgICAgXCJqc1wiOiBbXCJzcmMvY29udGVudC90b3V0aWFvLnRzXCJdLFxyXG4gICAgICBcInJ1bl9hdFwiOiBcImRvY3VtZW50X2VuZFwiXHJcbiAgICB9LFxyXG4gICAge1xyXG4gICAgICBcIm1hdGNoZXNcIjogW1wiaHR0cDovLyovKlwiLCBcImh0dHBzOi8vKi8qXCJdLFxyXG4gICAgICBcImpzXCI6IFtcclxuICAgICAgICBcInNyYy9jb250ZW50L2V4dHJhY3Rvci50c1wiXHJcbiAgICAgIF0sXHJcbiAgICAgIFwicnVuX2F0XCI6IFwiZG9jdW1lbnRfZW5kXCJcclxuICAgIH1cclxuICBdLFxyXG4gIFwid2ViX2FjY2Vzc2libGVfcmVzb3VyY2VzXCI6IFtcclxuICAgIHtcclxuICAgICAgXCJyZXNvdXJjZXNcIjogW1wiYXNzZXRzLypcIiwgXCJzcmMvZWRpdG9yL2luZGV4Lmh0bWxcIiwgXCJpbmplY3QtYXBpLmpzXCJdLFxyXG4gICAgICBcIm1hdGNoZXNcIjogW1wiPGFsbF91cmxzPlwiXVxyXG4gICAgfVxyXG4gIF1cclxufVxyXG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQTRhLFNBQVMsY0FBYyxlQUFlO0FBQ2xkLE9BQU8sV0FBVztBQUNsQixTQUFTLFdBQVc7QUFDcEIsT0FBTyxVQUFVO0FBQ2pCLFNBQVMsZUFBZTtBQUN4QixTQUFTLGNBQWMsV0FBVyxZQUFZLGFBQWEsY0FBYyxxQkFBcUI7OztBQ0w5RjtBQUFBLEVBQ0Usa0JBQW9CO0FBQUEsRUFDcEIsTUFBUTtBQUFBLEVBQ1IsYUFBZTtBQUFBLEVBQ2YsU0FBVztBQUFBLEVBQ1gsT0FBUztBQUFBLElBQ1AsTUFBTTtBQUFBLElBQ04sTUFBTTtBQUFBLElBQ04sT0FBTztBQUFBLEVBQ1Q7QUFBQSxFQUNBLFFBQVU7QUFBQSxJQUNSLGNBQWdCO0FBQUEsSUFDaEIsZUFBaUI7QUFBQSxFQUNuQjtBQUFBLEVBQ0EsYUFBZTtBQUFBLElBQ2I7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxFQUNGO0FBQUEsRUFDQSxrQkFBb0I7QUFBQSxJQUNsQjtBQUFBLElBQ0E7QUFBQSxFQUNGO0FBQUEsRUFDQSxZQUFjO0FBQUEsSUFDWixnQkFBa0I7QUFBQSxJQUNsQixNQUFRO0FBQUEsRUFDVjtBQUFBLEVBQ0EsaUJBQW1CO0FBQUEsSUFDakI7QUFBQSxNQUNFLFNBQVcsQ0FBQyxjQUFjLGFBQWE7QUFBQSxNQUN2QyxJQUFNLENBQUMsb0JBQW9CO0FBQUEsTUFDM0IsUUFBVTtBQUFBLE1BQ1YsWUFBYztBQUFBLElBQ2hCO0FBQUEsSUFDQTtBQUFBLE1BQ0UsU0FBVyxDQUFDLGdDQUFnQyw4QkFBOEI7QUFBQSxNQUMxRSxJQUFNLENBQUMsdUJBQXVCO0FBQUEsTUFDOUIsUUFBVTtBQUFBLElBQ1o7QUFBQSxJQUNBO0FBQUEsTUFDRSxTQUFXLENBQUMsMENBQTBDO0FBQUEsTUFDdEQsSUFBTSxDQUFDLDhCQUE4QjtBQUFBLE1BQ3JDLFFBQVU7QUFBQSxJQUNaO0FBQUEsSUFDQTtBQUFBLE1BQ0UsU0FBVyxDQUFDLDBCQUEwQjtBQUFBLE1BQ3RDLElBQU0sQ0FBQyx3QkFBd0I7QUFBQSxNQUMvQixRQUFVO0FBQUEsSUFDWjtBQUFBLElBQ0E7QUFBQSxNQUNFLFNBQVcsQ0FBQyxjQUFjLGFBQWE7QUFBQSxNQUN2QyxJQUFNO0FBQUEsUUFDSjtBQUFBLE1BQ0Y7QUFBQSxNQUNBLFFBQVU7QUFBQSxJQUNaO0FBQUEsRUFDRjtBQUFBLEVBQ0EsMEJBQTRCO0FBQUEsSUFDMUI7QUFBQSxNQUNFLFdBQWEsQ0FBQyxZQUFZLHlCQUF5QixlQUFlO0FBQUEsTUFDbEUsU0FBVyxDQUFDLFlBQVk7QUFBQSxJQUMxQjtBQUFBLEVBQ0Y7QUFDRjs7O0FEdEVBLElBQU0sbUNBQW1DO0FBU3pDLElBQU0sd0JBQW9GLENBQUM7QUFDM0YsSUFBTSx1QkFBdUI7QUFBQSxFQUMzQixFQUFFLE1BQU0sOEJBQThCLFNBQVMsQ0FBQyxtQ0FBbUMsR0FBRyxRQUFRLGVBQWU7QUFDL0c7QUFDQSxXQUFXLFVBQVUsc0JBQXNCO0FBQ3pDLE1BQUksV0FBVyxRQUFRLGtDQUFXLE9BQU8sSUFBSSxDQUFDLEdBQUc7QUFDL0MsMEJBQXNCLEtBQUssRUFBRSxTQUFTLE9BQU8sU0FBUyxJQUFJLENBQUMsT0FBTyxJQUFJLEdBQUcsUUFBUSxPQUFPLE9BQU8sQ0FBQztBQUFBLEVBQ2xHO0FBQ0Y7QUFDQSxJQUFNLFdBQVc7QUFBQSxFQUNmLEdBQUc7QUFBQSxFQUNILGlCQUFpQixDQUFDLEdBQUcsaUJBQWEsaUJBQWlCLEdBQUcscUJBQXFCO0FBQzdFO0FBR0EsU0FBUyx3QkFBd0I7QUFDL0IsU0FBTztBQUFBLElBQ0wsTUFBTTtBQUFBLElBQ04sY0FBYztBQUdaLFlBQU0sV0FBVyxRQUFRLGtDQUFXLE9BQU87QUFDM0MsWUFBTSxlQUFlLFFBQVEsa0NBQVcsWUFBWTtBQUVwRCxVQUFJLFdBQVcsUUFBUSxHQUFHO0FBQ3hCLFlBQUksQ0FBQyxXQUFXLFlBQVksR0FBRztBQUM3QixvQkFBVSxjQUFjLEVBQUUsV0FBVyxLQUFLLENBQUM7QUFBQSxRQUM3QztBQUVBLGNBQU0sUUFBUSxZQUFZLFFBQVE7QUFDbEMsbUJBQVcsUUFBUSxPQUFPO0FBQ3hCO0FBQUEsWUFDRSxRQUFRLFVBQVUsSUFBSTtBQUFBLFlBQ3RCLFFBQVEsY0FBYyxJQUFJO0FBQUEsVUFDNUI7QUFDQSxrQkFBUSxJQUFJLDhCQUE4QixJQUFJLEVBQUU7QUFBQSxRQUNsRDtBQUFBLE1BQ0Y7QUFHQSxZQUFNLFlBQVksUUFBUSxrQ0FBVyxZQUFZO0FBQ2pELFlBQU0sVUFBVSxRQUFRLGtDQUFXLE1BQU07QUFFekMsVUFBSSxXQUFXLFNBQVMsR0FBRztBQUN6QixjQUFNLGNBQWMsQ0FBQyxhQUFhLGdCQUFnQjtBQUNsRCxtQkFBVyxRQUFRLGFBQWE7QUFDOUIsZ0JBQU0sVUFBVSxRQUFRLFdBQVcsSUFBSTtBQUN2QyxnQkFBTSxXQUFXLFFBQVEsU0FBUyxJQUFJO0FBQ3RDLGNBQUksV0FBVyxPQUFPLEdBQUc7QUFDdkIseUJBQWEsU0FBUyxRQUFRO0FBQzlCLG9CQUFRLElBQUksd0JBQXdCLElBQUksV0FBVztBQUFBLFVBQ3JEO0FBQUEsUUFDRjtBQUFBLE1BQ0Y7QUFHQSxZQUFNLGVBQWUsUUFBUSxrQ0FBVyxvQkFBb0I7QUFDNUQsVUFBSSxXQUFXLFlBQVksR0FBRztBQUM1QixjQUFNLGtCQUFrQixLQUFLLE1BQU0sYUFBYSxjQUFjLE9BQU8sQ0FBQztBQUl0RSxjQUFNLHNCQUFzQjtBQUFBLFVBQzFCLElBQUksQ0FBQyxhQUFhLGdCQUFnQjtBQUFBLFVBQ2xDLFNBQVMsQ0FBQyxjQUFjLGFBQWE7QUFBQSxVQUNyQyxRQUFRO0FBQUEsUUFDVjtBQUdBLHdCQUFnQixrQkFBa0I7QUFBQSxVQUNoQztBQUFBLFVBQ0EsR0FBRyxnQkFBZ0I7QUFBQSxRQUNyQjtBQUVBLHNCQUFjLGNBQWMsS0FBSyxVQUFVLGlCQUFpQixNQUFNLENBQUMsQ0FBQztBQUNwRSxnQkFBUSxJQUFJLHlEQUF5RDtBQUFBLE1BQ3ZFO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDRjtBQUVBLElBQU8sc0JBQVEsYUFBYSxDQUFDLEVBQUUsS0FBSyxNQUFNO0FBQ3hDLFFBQU0sTUFBTSxRQUFRLE1BQU0sa0NBQVcsRUFBRTtBQUN2QyxRQUFNLFFBQVEsU0FBUztBQUN2QixTQUFPO0FBQUEsSUFDTCxTQUFTO0FBQUEsTUFDUCxNQUFNO0FBQUEsTUFDTixLQUFLO0FBQUEsTUFDTCxJQUFJLEVBQUUsU0FBUyxDQUFDO0FBQUEsTUFDaEIsc0JBQXNCO0FBQUEsSUFDeEI7QUFBQSxJQUNBLFFBQVE7QUFBQSxNQUNOLDBDQUEwQyxLQUFLLFVBQVUsSUFBSSwwQkFBMEIsRUFBRTtBQUFBLE1BQ3pGLHNDQUFzQyxLQUFLLFVBQVUsSUFBSSxzQkFBc0IsRUFBRTtBQUFBO0FBQUEsTUFFakYsd0JBQXdCLEtBQUssVUFBVSxDQUFDLEtBQUs7QUFBQSxNQUM3Qyx1QkFBdUIsS0FBSyxVQUFVLEtBQUs7QUFBQSxJQUM3QztBQUFBLElBQ0YsU0FBUztBQUFBLE1BQ1AsT0FBTztBQUFBLFFBQ0wsS0FBSyxRQUFRLGtDQUFXLEtBQUs7QUFBQSxRQUM3QixvQkFBb0IsUUFBUSxrQ0FBVyxhQUFhO0FBQUEsTUFDdEQ7QUFBQSxJQUNGO0FBQUEsSUFDQSxPQUFPO0FBQUE7QUFBQSxNQUVMLFFBQVEsUUFBUSxRQUFRO0FBQUEsTUFDeEIsV0FBVyxRQUFRLFdBQVc7QUFBQSxNQUM5QixlQUFlO0FBQUEsUUFDYixPQUFPO0FBQUEsVUFDTCxPQUFPLFFBQVEsa0NBQVcsc0JBQXNCO0FBQUEsVUFDaEQsUUFBUSxRQUFRLGtDQUFXLHVCQUF1QjtBQUFBLFFBQ3BEO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUMsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
