export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface LLMProvider {
  id: string;
  name: string;
  available(): boolean;
  complete(messages: Message[]): Promise<string>;
}
