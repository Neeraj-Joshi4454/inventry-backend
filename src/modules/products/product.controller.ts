import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendPaginated, sendSuccess } from '../../utils/apiResponse';
import { getPaginationParams } from '../../utils/pagination';
import { createProduct, getProductById, listProducts, updateProduct } from './product.service';
import type {
  CreateProductInput,
  ListProductsQuery,
  UpdateProductInput,
} from './product.validators';

export const createProductHandler = asyncHandler(async (req: Request, res: Response) => {
  const product = await createProduct({
    tenantId: req.user!.tenantId!,
    userId: req.user!.userId,
    userRole: req.user!.role,
    input: req.body as CreateProductInput,
    ipAddress: req.ip,
  });
  sendSuccess(res, 201, 'Product created successfully', product);
});

export const listProductsHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListProductsQuery;
  const pagination = getPaginationParams(query);
  const { products, meta } = await listProducts(req.user!.tenantId!, query, pagination);
  sendPaginated(res, 200, 'Products fetched successfully', products, meta);
});

export const getProductHandler = asyncHandler(async (req: Request, res: Response) => {
  const product = await getProductById(req.user!.tenantId!, req.params.id as string);
  sendSuccess(res, 200, 'Product fetched successfully', product);
});

export const updateProductHandler = asyncHandler(async (req: Request, res: Response) => {
  const product = await updateProduct({
    tenantId: req.user!.tenantId!,
    userId: req.user!.userId,
    userRole: req.user!.role,
    productId: req.params.id as string,
    input: req.body as UpdateProductInput,
    ipAddress: req.ip,
  });
  sendSuccess(res, 200, 'Product updated successfully', product);
});
