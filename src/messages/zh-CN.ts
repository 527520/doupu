/**
 * 豆谱全部 UI 文案（zh-CN）。
 * 约定：所有界面文案必须从这里引用，禁止在组件中硬编码字符串。
 * 错误码文案（errors）与 src/lib 的错误分类一一对应。
 */
export const zhCN = {
  app: {
    name: '豆谱',
    tagline: '上传照片，生成拼豆图纸',
    description: '豆谱（DouPu）—— 免费开源的拼豆图纸生成工具：上传照片或像素画，裁剪、调参、修补，导出可打印的拼豆图纸。',
  },
  nav: {
    workbench: '工作台',
    designs: '我的设计',
    palettes: '色板管理',
    help: '帮助',
    about: '关于',
    login: '登录',
    register: '注册',
    logout: '退出登录',
  },
  home: {
    uploadHint: '拖拽图片到此处，或点击选择文件（支持拍照）',
    guideStep1: '上传照片或像素画',
    guideStep2: '调整尺寸与颜色参数',
    guideStep3: '修补细节并导出图纸',
    openSourceNotice: '豆谱是 AGPL-3.0 开源软件',
  },
  footer: {
    sourceCode: '源码仓库（AGPL-3.0）',
    icp: '备案号：上线后填写',
    privacy: '隐私政策',
    attribution: '基于 Zippland/perler-beads 二次开发',
  },
  errors: {
    EMPTY_FILE: '文件为空，请重新选择。',
    UNSUPPORTED_TYPE: '不支持的图片格式，请上传 JPEG、PNG、WebP 或 HEIC 图片。',
    TOO_LARGE_FILE: '文件超过 20 MB，请压缩后再上传。',
    TOO_MANY_PIXELS: '图片像素超过上限（8000×8000），请裁剪后再上传。',
    ANIMATED: '不支持动图，请上传静态图片。',
    DECODE_FAILED: '无法解析该图片，文件可能已损坏。',
    HEIC_UNSUPPORTED: '当前浏览器无法处理 HEIC 图片，请转为 JPEG/PNG 后重试。',
    UNKNOWN: '发生未知错误，请重试。',
  },
} as const;

export type Messages = typeof zhCN;
