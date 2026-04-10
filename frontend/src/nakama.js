import { Client } from "@heroiclabs/nakama-js";

const host   = import.meta.env.VITE_NAKAMA_HOST || "127.0.0.1";
const port   = import.meta.env.VITE_NAKAMA_PORT || "7350";
const useSSL = import.meta.env.VITE_NAKAMA_SSL === "true" || port === "443";

const client = new Client("defaultkey", host, port, useSSL);

export default client;