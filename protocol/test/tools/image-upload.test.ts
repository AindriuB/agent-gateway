/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import {
  conservativeProblems,
  imageUpload,
  IMAGE_UPLOAD_MAX_BASE64,
  IMAGE_UPLOAD_MAX_BYTES,
  parseImageUploadText,
  toJsonSchema,
} from '../../src/tools/index.js';

describe('image_upload definition', () => {
  it('is a player write tool with no conservative-schema problems', () => {
    expect(imageUpload).toMatchObject({ minRole: 'player', category: 'write' });
    expect(conservativeProblems(imageUpload)).toEqual([]);
  });
  it('has no URL argument and declares the base64 cap', () => {
    const keys = Object.keys(imageUpload.input.shape);
    expect(keys).toEqual([
      'data',
      'mime',
      'actorUuid',
      'setPortrait',
      'setToken',
      'sceneUuid',
      'setBackground',
    ]);
    const props = toJsonSchema(imageUpload).inputSchema.properties as Record<string, any>;
    expect(props.data.maxLength).toBe(IMAGE_UPLOAD_MAX_BASE64);
    expect(IMAGE_UPLOAD_MAX_BASE64).toBe(4 * Math.ceil(IMAGE_UPLOAD_MAX_BYTES / 3));
  });
  it('accepts only the three raster mimes and rejects extra keys', () => {
    const ok = { data: 'AAAA', mime: 'image/png' };
    expect(imageUpload.input.safeParse(ok).success).toBe(true);
    expect(imageUpload.input.safeParse({ ...ok, mime: 'image/svg+xml' }).success).toBe(false);
    expect(imageUpload.input.safeParse({ ...ok, url: 'x' }).success).toBe(false);
    expect(
      imageUpload.input.safeParse({ ...ok, data: 'A'.repeat(IMAGE_UPLOAD_MAX_BASE64 + 1) }).success,
    ).toBe(false);
  });
});

describe('parseImageUploadText', () => {
  const sha = 'a'.repeat(64);
  const head = `Uploaded agent-gateway/uploads/u1/ab12-12.png (12 bytes, image/png, sha256 ${sha})`;
  it('recovers path, size, hash and updated documents', () => {
    expect(parseImageUploadText(`${head}\nUpdated: Actor.a, Scene.s\nSet portrait.`)).toEqual({
      path: 'agent-gateway/uploads/u1/ab12-12.png',
      bytes: 12,
      mime: 'image/png',
      sha256: sha,
      updated: ['Actor.a', 'Scene.s'],
    });
  });
  it('handles a file with no targets and rejects other text', () => {
    expect(parseImageUploadText(`${head}\nThe file is stored.`)?.updated).toEqual([]);
    expect(parseImageUploadText('FORBIDDEN: nope')).toBeNull();
  });
});
