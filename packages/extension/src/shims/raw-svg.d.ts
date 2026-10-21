// Vite 的 ?raw 导入：把文件内容当字符串读进来。
// service worker 用它读 public/icons/logo.svg，再随 args 递进注入函数
// （注入函数在页面隔离世界里执行，引用不到任何模块标识符，见 pasteEntryPoint.ts 头注释）。
declare module '*.svg?raw' {
  const content: string
  export default content
}
