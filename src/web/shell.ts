function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderAppShell(title = "YiJiex AI Repo Analyzer"): string {
  return `<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      tailwind.config = {
        theme: {
          extend: {
            fontFamily: {
              display: ["Space Grotesk", "sans-serif"],
              mono: ["IBM Plex Mono", "monospace"]
            },
            colors: {
              ink: "#071316",
              coal: "#102126",
              slate: "#173138",
              mist: "#9eb4b0",
              teal: "#35c7a0",
              clay: "#d87755",
              gold: "#e9bf5b"
            },
            boxShadow: {
              panel: "0 30px 100px rgba(0, 0, 0, 0.35)"
            }
          }
        }
      };
    </script>
  </head>
  <body class="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(53,199,160,0.16),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(233,191,91,0.10),_transparent_24%),linear-gradient(180deg,_#071316_0%,_#0a171b_35%,_#0d1f24_100%)] font-display text-white">
    <div id="root"></div>
    <noscript>
      <div style="max-width: 720px; margin: 64px auto; padding: 24px; background: #102126; color: white; border: 1px solid rgba(255,255,255,.1); border-radius: 24px; font-family: 'Space Grotesk', sans-serif;">
        React dashboard membutuhkan JavaScript aktif di browser.
      </div>
    </noscript>
    <script type="module" src="/assets/client.js"></script>
  </body>
</html>`;
}

export function renderServerMessagePage(title: string, message: string, errorCode?: string): string {
  return `<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body class="min-h-screen bg-[linear-gradient(180deg,_#071316_0%,_#0d1f24_100%)] text-white">
    <main class="mx-auto max-w-3xl px-4 py-20">
      <section class="rounded-[2rem] border border-white/10 bg-[#102126] p-8 shadow-2xl">
        <p class="text-xs font-semibold uppercase tracking-[0.3em] text-teal-300">${escapeHtml(errorCode || "Info")}</p>
        <h1 class="mt-3 text-3xl font-black">${escapeHtml(title)}</h1>
        <p class="mt-4 text-base leading-7 text-stone-300">${escapeHtml(message)}</p>
        <div class="mt-8">
          <a href="/" class="inline-flex rounded-full bg-teal px-5 py-3 text-sm font-semibold text-ink">Kembali ke Home</a>
        </div>
      </section>
    </main>
  </body>
</html>`;
}
