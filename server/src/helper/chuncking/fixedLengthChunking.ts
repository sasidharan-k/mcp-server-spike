interface ChunkingStrategy {
    chunkSize?: number;
    overlap?: number;
    splitText(text: string): string[];
}

export class FixedLengthChunking implements ChunkingStrategy {
    constructor(
        public readonly chunkSize: number = 1000,
        public readonly overlap: number = 200
    ) {
        if (overlap >= chunkSize) {
            throw new Error('Overlap must be less than chunk size');
        }
    }

    splitText(text: string): string[] {
        if (!text) return [];

        const chunks: string[] = [];
        let currentPosition = 0;

        while (currentPosition < text.length) {
            const end = Math.min(currentPosition + this.chunkSize, text.length);
            chunks.push(text.slice(currentPosition, end));

            currentPosition = end - this.overlap;
            if (currentPosition >= text.length - this.overlap) {
                break;
            }
        }

        return chunks;
    }
}
