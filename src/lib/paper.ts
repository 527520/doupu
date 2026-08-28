/**
 * 纸张常量（J-3）：config.ts 与 export/pdfLayout.ts 此前各自硬编码 210/297。
 * 单独成文件是为了避免 config（服务端也会加载）反过来依赖 export 层。
 */
export const A4_WIDTH_MM = 210;
export const A4_HEIGHT_MM = 297;
/** 1 mm = 72/25.4 pt */
export const MM_TO_PT = 72 / 25.4;
