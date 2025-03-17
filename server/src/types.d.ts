// Type declarations for modules that don't have TypeScript definitions
declare module 'express' {
  import express from '@types/express';
  export = express;
}

declare module 'cors' {
  import cors from '@types/cors';
  export = cors;
}