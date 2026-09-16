import { buildTxt2Img, buildInpaint } from './generate.js';

// SD1.5 FaceID references are confined to a declared subject region.
export function buildReferencePhoto({ imageName, referenceCrop, region, identityWeight = 0.85, faceWeight = 1, ...options }) {
  if (!imageName || typeof imageName !== 'string') throw new Error('Upload a reference photo first.');
  if (!region || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(region[key]))
    || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0
    || region.x + region.width > 1 || region.y + region.height > 1) {
    throw new Error('Choose a subject region inside the image.');
  }
  if (!Number.isFinite(identityWeight) || identityWeight < 0 || identityWeight > 2) {
    throw new Error('Identity weight must be between 0 and 2.');
  }
  if (!Number.isFinite(faceWeight) || faceWeight < 0 || faceWeight > 2) {
    throw new Error('Face weight must be between 0 and 2.');
  }
  const result = buildTxt2Img(options);
  const { graph } = result;
  const width = options.width ?? 1024;
  const height = options.height ?? 1024;
  graph['20'] = { class_type: 'LoadImage', inputs: { image: imageName } };
  if (referenceCrop) {
    if (!['x', 'y', 'width', 'height'].every(key => Number.isInteger(referenceCrop[key]))
      || referenceCrop.x < 0 || referenceCrop.y < 0 || referenceCrop.width < 1 || referenceCrop.height < 1) {
      throw new Error('Reference crop must use positive pixel dimensions and nonnegative offsets.');
    }
    graph['26'] = { class_type: 'ImageCrop', inputs: { image: ['20', 0], ...referenceCrop } };
  }
  graph['21'] = { class_type: 'IPAdapterUnifiedLoaderFaceID', inputs: {
    model: ['1', 0], preset: 'FACEID PLUS V2', lora_strength: 0.6, provider: 'CPU'
  } };
  graph['22'] = { class_type: 'SolidMask', inputs: { value: 0, width, height } };
  graph['23'] = { class_type: 'SolidMask', inputs: {
    value: 1, width: Math.max(1, Math.round(width * region.width)), height: Math.max(1, Math.round(height * region.height))
  } };
  graph['24'] = { class_type: 'MaskComposite', inputs: {
    destination: ['22', 0], source: ['23', 0], x: Math.round(width * region.x), y: Math.round(height * region.y), operation: 'add'
  } };
  graph['25'] = { class_type: 'IPAdapterFaceID', inputs: {
    model: ['21', 0], ipadapter: ['21', 1], image: [referenceCrop ? '26' : '20', 0], attn_mask: ['24', 0],
    weight: identityWeight, weight_faceidv2: faceWeight, weight_type: 'linear', combine_embeds: 'concat',
    start_at: 0, end_at: 1, embeds_scaling: 'V only'
  } };
  for (const node of Object.values(graph)) {
    if (node.class_type === 'KSampler') node.inputs.model = ['25', 0];
  }
  return result;
}

// Decoding alone changes unselected pixels; restore the original outside the mask.
export function buildPreservingPhotoEdit(options) {
  const result = buildInpaint(options);
  result.graph['10'] = { class_type: 'ImageCompositeMasked', inputs: {
    destination: ['2', 0], source: ['8', 0], mask: ['3', 1], x: 0, y: 0, resize_source: false
  } };
  result.graph['9'].inputs.images = ['10', 0];
  return result;
}
