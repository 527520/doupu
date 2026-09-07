# 03 首页 hero

Status: ready-for-agent
Completion: not-started

## 目标

去掉「选择图片，开始制作」莓果大色块，用钉板落区 + 一枚紧凑主按钮承载同一动作；390×844 首屏仍完整显示选图。

## 范围

- `UploadDropzone` 的 `prominent` 变体改为钉板纹理落区：白底点阵、虚线描边、居中 `Button variant="primary" icon="upload"`「选择图片」+ 格式提示；拖入时纹理点变莓果。
- `HomeUploadCard`：空白起稿降为次级行（quiet 按钮 + 说明）。
- 删除 `.upload-dropzone-primary` 红块规则与 `prefers-reduced-motion` 中对应条目。
- `home-hero` 两列比例微调，首屏保证：品牌 → 同意提示 → 标题 → 落区。

## 验收

- 390/350 首屏含完整落区与按钮；三浏览器 `17-visual-refinement` 首页用例通过；axe 通过。
