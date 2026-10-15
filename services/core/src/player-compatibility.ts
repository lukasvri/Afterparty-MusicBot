// Old messages can outlive a bot update. Recognize their buttons without running
// or importing the old engine. Newly rendered buttons use the krutt namespace.
export function isPlayerButton(id:string){return /^(?:krutt|muse):/.test(id);}
export function playerAction(id:string){return id.replace(/^(?:krutt|muse):/,'');}
