declare module "refractor/core" {
  const refractor: {
    highlight(code: string, language: string): unknown;
    register(language: unknown): void;
  };
  export = refractor;
}

declare module "refractor/lang/*" {
  const lang: unknown;
  export = lang;
}
