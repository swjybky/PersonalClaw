/// <reference types="vite/client" />

import type { PersonalClawApi } from "@personal-claw/contracts";

declare global {
  interface Window {
    personalClaw: PersonalClawApi;
  }
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}
