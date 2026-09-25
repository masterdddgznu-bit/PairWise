export interface Message {
  offset: number;
  key: string | null;
  value: string;
}

export type Delivery = {
  deliveryId: string;
  topic: string;
  partition: number;
  offset: number;
  key: string | null;
  value: string;
  deliveryCount: number;
};
