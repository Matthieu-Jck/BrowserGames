// chapters.ts — the assembled journey. Each chapter is pure data from content/.
import type { ChapterDef } from './types';
import { chapter1 } from '@/content/chapter1';
import { chapter2 } from '@/content/chapter2';
import { chapter3 } from '@/content/chapter3';
import { chapter4 } from '@/content/chapter4';
import { chapter5 } from '@/content/chapter5';

export const CHAPTERS: ChapterDef[] = [chapter1, chapter2, chapter3, chapter4, chapter5];
