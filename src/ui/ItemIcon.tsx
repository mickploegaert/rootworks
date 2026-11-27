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
