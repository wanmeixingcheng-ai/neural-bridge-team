export const ATTACHMENT_TOKEN_CHAR_RATIO = 4;
export const ATTACHMENT_TEXT_BUDGET_TOKENS = 4500;
export const ATTACHMENT_TEXT_PER_FILE_TOKENS = 1500;
export const ATTACHMENT_TEXT_BUDGET_CHARS = ATTACHMENT_TEXT_BUDGET_TOKENS * ATTACHMENT_TOKEN_CHAR_RATIO;
export const ATTACHMENT_TEXT_PER_FILE_CHARS = ATTACHMENT_TEXT_PER_FILE_TOKENS * ATTACHMENT_TOKEN_CHAR_RATIO;
export const ATTACHMENT_MAX_TOTAL_BYTES = 10 * 1024 * 1024;
export const IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const IMAGE_MAX_WIDTH = 4096;
export const IMAGE_MAX_HEIGHT = 4096;
export const IMAGE_MAX_COUNT = 4;

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function attachmentLimitError(message, lang) {
  if (lang === "ja") return `添付制限: ${message}`;
  if (lang === "en") return `Attachment limit: ${message}`;
  return `附件限制：${message}`;
}

export function estimateTokensFromChars(chars) {
  return Math.ceil(chars / ATTACHMENT_TOKEN_CHAR_RATIO);
}

export function validateAttachmentTotalSize(attachments, lang) {
  const totalBytes = attachments.reduce((sum, item) => sum + (item.file?.size || 0), 0);
  if (totalBytes > ATTACHMENT_MAX_TOTAL_BYTES) {
    throw new Error(attachmentLimitError(`total size exceeds ${formatBytes(ATTACHMENT_MAX_TOTAL_BYTES)}.`, lang));
  }
  return totalBytes;
}

export function validateImageCount(count, lang) {
  if (count > IMAGE_MAX_COUNT) {
    throw new Error(attachmentLimitError(`最多只能上传 ${IMAGE_MAX_COUNT} 张图片。`, lang));
  }
}

export function validateImageFile({ file, width, height, lang }) {
  if (file.size > IMAGE_MAX_BYTES) {
    throw new Error(attachmentLimitError(`${file.name} exceeds ${formatBytes(IMAGE_MAX_BYTES)}.`, lang));
  }
  if (width > IMAGE_MAX_WIDTH || height > IMAGE_MAX_HEIGHT) {
    throw new Error(attachmentLimitError(`${file.name} is ${width}x${height}; max is ${IMAGE_MAX_WIDTH}x${IMAGE_MAX_HEIGHT}.`, lang));
  }
}

