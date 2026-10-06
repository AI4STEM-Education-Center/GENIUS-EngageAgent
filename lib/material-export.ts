import type { ContentItem } from "./types";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]!);

const isImageDataUri = (value: string) => /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/.test(value);

/** A self-contained student handout; private planning fields are deliberately not serialized. */
export function buildStudentMaterialHtml(item: ContentItem, imageDataUri: string): string {
  if (!isImageDataUri(imageDataUri)) throw new Error("The material needs an embedded PNG, JPEG, WebP or GIF image.");
  const activity = item.activity;
  const stages = activity ? activity.stages.map((stage, index) => {
    const panelIndex = activity.mappingDepth && activity.image.panels?.length === 2 && index < 2 ? index : undefined;
    const panel = panelIndex === undefined ? undefined : activity.image.panels?.[panelIndex];
    const showImage = Boolean(panel) || index === activity.image.revealAt;
    const image = !showImage ? "" : `<figure>${panel
      ? `<div class="panel"><img src="${imageDataUri}" alt="${escapeHtml(panel.alt)}" style="left:${panelIndex === 0 ? "0" : "-100%"}"></div>`
      : `<img src="${imageDataUri}" alt="${escapeHtml(activity.image.panels?.map(value => value.alt).join(" ") ?? activity.image.scene)}">`}
      <figcaption>${escapeHtml(panel?.caption ?? activity.image.panels?.map(value => value.caption).join(" / ") ?? "")}<span>Schematic illustration, not experimental measurements.</span></figcaption></figure>`;
    return `<section data-stage="${escapeHtml(stage.id)}"${index > 0 ? " hidden" : ""} aria-labelledby="stage-title-${index}">
      <h2 id="stage-title-${index}">${escapeHtml(stage.title)}</h2>
      ${stage.id === "compare" ? '<div id="recorded-prediction" hidden><h3>Your prediction</h3><p></p></div>' : ""}
      <p>${escapeHtml(stage.text)}</p>${image}
      ${stage.id === "prediction" ? '<label for="prediction">Your prediction</label><textarea id="prediction" rows="3" maxlength="2000"></textarea>' : ""}
      ${stage.id === "question" ? '<label for="question">Your scientific question</label><textarea id="question" rows="4" maxlength="2000"></textarea><p class="hint">Your response stays on this page. Copy it before closing.</p>' : ""}
    </section>`;
  }).join("\n") : `<section><p>${escapeHtml(item.body)}</p><figure><img src="${imageDataUri}" alt="${escapeHtml(item.title)}"></figure></section>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(item.title)} — EngageAgent</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f5f7fa;color:#182230;font-family:Arial,sans-serif;line-height:1.6}main{max-width:800px;margin:40px auto;padding:32px;background:white;border-radius:16px}h1{font-size:1.8rem;line-height:1.25}h2{font-size:1.25rem;line-height:1.35}h3,label{font-size:1rem;font-weight:600}section{padding:20px 0;border-top:1px solid #dbe1e8}p{white-space:pre-line}figure{margin:20px 0}img{display:block;max-width:100%;height:auto;max-height:540px;object-fit:contain}figcaption,.hint{font-size:.85rem;color:#536172}figcaption span{display:block}.panel{position:relative;width:min(100%,288px);aspect-ratio:3/4;overflow:hidden}.panel img{position:absolute;top:0;width:200%;max-width:none;height:100%;object-fit:fill}textarea{display:block;width:100%;margin-top:8px;padding:12px;font:inherit;border:1px solid #9ba8b8;border-radius:8px}textarea[readonly]{background:#f0f3f7}button{padding:12px 20px;background:#ba0c2f;color:white;border:0;border-radius:8px;font:inherit;font-weight:600;cursor:pointer}button:disabled{background:#a5acb7;cursor:not-allowed}[hidden]{display:none!important}@media(max-width:600px){main{margin:0;padding:20px;border-radius:0}}@media print{body{background:white}main{margin:0;padding:0}button,.hint{display:none}section{break-inside:avoid}}
</style></head><body><main><header><p class="hint">EngageAgent · Explore and ask</p><h1>${escapeHtml(item.title)}</h1></header>
${stages}
${activity ? '<button type="button" id="continue">Continue</button><noscript><p>Enable JavaScript to explore this activity one step at a time.</p></noscript>' : ""}
</main>${activity ? `<script>
(() => {
  const stages = Array.from(document.querySelectorAll('[data-stage]'));
  const button = document.getElementById('continue');
  const prediction = document.getElementById('prediction');
  let current = 0;
  const update = () => {
    const needsPrediction = stages[current].dataset.stage === 'prediction';
    button.disabled = needsPrediction && !prediction.value.trim();
    button.title = button.disabled ? 'Write your prediction first' : 'Continue';
    button.hidden = current === stages.length - 1;
  };
  if (prediction) prediction.addEventListener('input', update);
  button.addEventListener('click', () => {
    if (button.disabled || current >= stages.length - 1) return;
    if (stages[current].dataset.stage === 'prediction') prediction.readOnly = true;
    current += 1;
    stages[current].hidden = false;
    if (stages[current].dataset.stage === 'compare' && prediction) {
      const recorded = document.getElementById('recorded-prediction');
      recorded.querySelector('p').textContent = prediction.value;
      recorded.hidden = false;
    }
    update();
    stages[current].setAttribute('tabindex', '-1');
    stages[current].focus();
  });
  update();
})();
</script>` : ""}</body></html>`;
}

/** Embed the current image so downloaded material does not depend on a temporary media URL. */
export async function downloadStudentMaterial(item: ContentItem, imageUrl: string): Promise<void> {
  const response = await fetch(imageUrl.startsWith("data:") ? imageUrl : `/api/download?url=${encodeURIComponent(imageUrl)}`);
  if (!response.ok) throw new Error("Unable to download the image. Please try again.");
  const blob = await response.blob();
  if (!/^image\/(png|jpeg|webp|gif)$/.test(blob.type)) throw new Error("The image is not ready to download. Please regenerate it and try again.");
  const dataUri = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Unable to read the material image."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
  const html = buildStudentMaterialHtml(item, dataUri);
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${item.title.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 100) || "engage-agent-material"}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
