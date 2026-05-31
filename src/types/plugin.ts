export interface PluginInput {
  client: any;
  project: any;
  directory: string;
  worktree: string;
  experimental_workspace: {
    register(type: string, adaptor: any): void;
  };
  serverUrl: URL;
  $: any;
}

export interface PluginHooks {
  cleanup?: () => Promise<void>;
  [key: string]: any;
}

export interface Plugin {
  id: string;
  server: (input: PluginInput) => Promise<PluginHooks>;
}
