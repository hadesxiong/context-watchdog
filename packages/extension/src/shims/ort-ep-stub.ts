// onnxruntime-web 的 webgpu/webgl 子路径打桩（vite.config.ts resolve.alias 指向此处）
//
// gliner 的 dist 顶层静态 `import ort_WEBGPU/ort_WEBGL from 'onnxruntime-web/webgpu|webgl'`
// （仅 executionProvider 为 webgpu/webgl 的分支才真正使用），不打桩会把 21.3MB 的
// ort-wasm-simd-threaded.jsep.wasm 拖进构建产物——而本项目 executionProvider 固定 'wasm'，
// jsep 资产运行时永远拉不到。打桩后该模块及其资产引用整体不进产物（-21.3MB）。
// 安全性：真若误走 GPU 分支，会在这里因 InferenceSession 不存在立刻抛错并被
// runLoad 捕获为「加载失败」，不会静默降级。
export default {}
