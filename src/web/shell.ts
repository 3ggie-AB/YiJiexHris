function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderHead(title: string): string {
  return `
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      tailwind.config = {
        darkMode: ["class"],
        theme: {
          extend: {
            fontFamily: {
              sans: ["Sora", "sans-serif"],
              mono: ["IBM Plex Mono", "monospace"]
            },
            boxShadow: {
              glossy: "0 26px 80px rgba(0, 0, 0, 0.42)"
            }
          }
        }
      };
    </script>
    <style>
      :root {
        color-scheme: dark;
      }

      html {
        min-height: 100%;
        background:
          radial-gradient(circle at top, rgba(56, 189, 248, 0.14), transparent 28%),
          radial-gradient(circle at 18% 18%, rgba(99, 102, 241, 0.12), transparent 22%),
          linear-gradient(180deg, #020617 0%, #040b17 35%, #02040c 100%);
      }

      body {
        min-height: 100vh;
        margin: 0;
        background: transparent;
      }

      * {
        box-sizing: border-box;
      }

      ::selection {
        background: rgba(56, 189, 248, 0.34);
        color: #f8fafc;
      }

      ::-webkit-scrollbar {
        width: 10px;
        height: 10px;
      }

      ::-webkit-scrollbar-track {
        background: rgba(15, 23, 42, 0.45);
      }

      ::-webkit-scrollbar-thumb {
        border-radius: 999px;
        background: linear-gradient(180deg, rgba(56, 189, 248, 0.45), rgba(14, 165, 233, 0.2));
      }

      ::-webkit-scrollbar-thumb:hover {
        background: linear-gradient(180deg, rgba(125, 211, 252, 0.52), rgba(14, 165, 233, 0.28));
      }
    </style>`;
}

export function renderAppShell(title = "YiJiex AI Repo Analyzer"): string {
  return `<!doctype html>
<html lang="id" class="dark">
  <head>
${renderHead(title)}
  </head>
  <body class="bg-slate-950 font-sans text-slate-100 antialiased">
    <div id="root"></div>
    <noscript>
      <div style="max-width: 720px; margin: 64px auto; padding: 24px; background: rgba(15, 23, 42, 0.88); color: white; border: 1px solid rgba(255,255,255,.1); border-radius: 24px; font-family: 'Sora', sans-serif; box-shadow: 0 26px 80px rgba(0,0,0,.42);">
        React dashboard membutuhkan JavaScript aktif di browser.
      </div>
    </noscript>
    <script type="module" src="/assets/client.js"></script>
  </body>
</html>`;
}

export function renderServerMessagePage(title: string, message: string, errorCode?: string): string {
  return `<!doctype html>
<html lang="id" class="dark">
  <head>
${renderHead(title)}
  </head>
  <body class="bg-slate-950 font-sans text-slate-100 antialiased">
    <main class="mx-auto max-w-3xl px-4 py-20">
      <section class="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(12,20,35,0.92),rgba(5,10,20,0.88))] p-8 shadow-[0_26px_80px_rgba(0,0,0,0.42)]">
        <p class="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-200">${escapeHtml(errorCode || "Info")}</p>
        <h1 class="mt-3 text-3xl font-semibold text-white">${escapeHtml(title)}</h1>
        <p class="mt-4 text-base leading-8 text-slate-300">${escapeHtml(message)}</p>
        <div class="mt-8">
          <a href="/" class="inline-flex h-11 items-center justify-center rounded-full border border-cyan-300/30 bg-[linear-gradient(135deg,rgba(102,214,255,0.95),rgba(132,246,255,0.78))] px-5 text-sm font-semibold text-slate-950 shadow-[0_18px_55px_rgba(56,189,248,0.35)]">Kembali ke Home</a>
        </div>
      </section>
    </main>
  </body>
</html>`;
}
