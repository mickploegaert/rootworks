import { itemIcon } from '../game/render/sprites/items.ts';
import { RESOURCES, type ResourceId } from '../game/resources/ResourceDefs.ts';

const urls = new Map<ResourceId, string>();
const iconUrl = (id: ResourceId) => {
  let u = urls.get(id);
  if (!u) urls.set(id, (u = itemIcon(id).toCanvas().toDataURL()));
  return u;
};

/** An item's pixel-art icon. With `explain`, hovering shows what the item is and what it is for. */
export function ItemIcon({ id, explain = false }: { id: ResourceId; explain?: boolean }) {
  const r = RESOURCES[id];
  return <img className="item-icon" src={iconUrl(id)} alt={r?.name ?? id} title={explain && r ? `${r.name}: ${r.description}\n\n${r.use}` : r?.name} />;
}

/** The Spark: ROOTWORKS' one currency, a four-pointed seed of light. */
export function Spark() {
  return (
    <svg className="spark-icon" viewBox="0 0 12 12" aria-hidden>
      <path d="M6 0 L7.3 4.7 L12 6 L7.3 7.3 L6 12 L4.7 7.3 L0 6 L4.7 4.7 Z" />
    </svg>
  );
}
