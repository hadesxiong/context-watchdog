// onnxruntime-web 的 webgpu/webgl 子路径打桩（vite.config.ts resolve.alias 指向此处）：gliner 的 dist
// 顶层静态 import 了它们，不打桩会把 21.3MB 的 jsep.wasm 拖进产物（本项目 EP 固定 'wasm'，运行时永远
// 拉不到）；真误走 GPU 分支会因 InferenceSession 不存在立刻抛错、被 runLoad 捕获，不会静默降级。
export default {}
