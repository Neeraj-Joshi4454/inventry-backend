import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination';

export const createProductSchema = z.object({
  name: z.string().min(1, 'Product name is required'),
  sku: z.string().min(1, 'SKU is required'),
  categoryId: z.string().min(1, 'Category is required'),
  unitId: z.string().min(1, 'Unit is required'),
  description: z.string().optional(),
  purchasePrice: z.number().min(0).default(0),
  sellingPrice: z.number().min(0).default(0),
  // Doubles as both "minimum stock level" (the number the user sets when
  // creating the product) and the low-stock threshold the Inventory screen
  // classifies against — the same field the rest of the system already
  // reads via Product.lowStockThreshold (see inventory.query.service.ts).
  lowStockThreshold: z.number().min(0, 'Minimum stock level must be zero or greater'),
  hsnCode: z.string().optional(),
  taxRate: z.number().min(0).max(100).default(0),
  isPriceInclusive: z.boolean().default(false),
});

export const updateProductSchema = createProductSchema.partial();

export const listProductsQuerySchema = paginationQuerySchema.extend({
  search: z.string().optional(),
  categoryId: z.string().optional(),
});

export const productIdParamSchema = z.object({
  id: z.string().min(1),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
