declare module "dom-to-image-more" {
  const domtoimage: {
    toPng(node: HTMLElement, options?: Record<string, unknown>): Promise<string>;
    toJpeg(node: HTMLElement, options?: Record<string, unknown>): Promise<string>;
  };
  export default domtoimage;
}
