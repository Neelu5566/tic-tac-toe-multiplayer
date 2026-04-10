import { Client } from "@heroiclabs/nakama-js";

const host   = import.meta.env.VITE_NAKAMA_HOST || "127.0.0.1";
const port   = import.meta.env.VITE_NAKAMA_PORT || "7350";
const useSSL = host !== "127.0.0.1" && host !== "localhost";

const client = new Client("defaultkey", host, port, useSSL);

export default client;