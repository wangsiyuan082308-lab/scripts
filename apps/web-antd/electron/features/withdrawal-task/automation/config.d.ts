import 'dotenv/config';
export declare function loadEvolutionConfig(): any;
export declare function saveEvolutionConfig(config: any): void;
export declare const evolutionConfig: any;
export declare const CONFIG: {
    url: string;
    password: string;
    targetStores: string[];
    userDataDir: string;
    coordsFile: string;
    baseWaitTime: any;
    minWithdrawAmount: number;
};
export interface Coords {
    [storeName: string]: {
        x: number;
        y: number;
    }[];
}
export declare function loadCoords(): Coords;
export declare function saveCoords(coords: Coords): void;
