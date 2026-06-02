import { Redis } from "@upstash/redis";
import { neon } from "@neondatabase/serverless";

let redisClient;
let sqlClient;

export function hasRedisStore() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

export function redis() {
  if (!hasRedisStore()) return null;
  if (!redisClient) {
    redisClient = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return redisClient;
}

export function hasPostgresStore() {
  return Boolean(process.env.DATABASE_URL);
}

export function sql() {
  if (!hasPostgresStore()) return null;
  if (!sqlClient) {
    sqlClient = neon(process.env.DATABASE_URL);
  }
  return sqlClient;
}
