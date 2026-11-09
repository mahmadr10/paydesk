import { Request, Response } from "express";
import * as orderService from "../services/orderService";
import { getRefundStats } from "../services/refundStatsService";

export async function getConfig(_req: Request, res: Response) {
  res.json({ success: true, data: orderService.getPaymentsConfig() });
}

export async function getCatalog(_req: Request, res: Response) {
  res.json({ success: true, data: { products: orderService.getCatalog() } });
}

export async function createOrder(req: Request, res: Response) {
  const order = await orderService.createOrder(req.user!.userId, req.body.items);
  res.status(201).json({ success: true, data: { order } });
}

export async function captureOrder(req: Request, res: Response) {
  const order = await orderService.captureOrder(req.params.id as string, req.user!);
  res.json({ success: true, data: { order } });
}

export async function listOrders(req: Request, res: Response) {
  const orders = await orderService.listOrders(req.user!, req.query.paid === "true");
  res.json({ success: true, data: { orders } });
}

export async function getOrder(req: Request, res: Response) {
  const order = await orderService.getOrder(req.params.id as string, req.user!);
  res.json({ success: true, data: { order } });
}

export async function refundStats(_req: Request, res: Response) {
  res.json({ success: true, data: await getRefundStats() });
}
