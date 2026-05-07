import { open, type DB } from '@op-engineering/op-sqlite';
import {
  Place,
  Segment,
  DayLog,
  GpsPoint,
  ActivityType,
} from '../models/types';

const DB_NAME = 'lifemap.db';
const SCHEMA_VERSION = 1;

class Database {
  private db: DB | null = null;

  init(): void {
    if (this.db) return;
    this.db = open({ name: DB_NAME });
    this.migrate();
  }

  private migrate(): void {
    const db = this.getDb();

    const versionResult = db.executeSync('PRAGMA user_version');
    const currentVersion = (versionResult.rows[0]?.user_version as number) ?? 0;

    if (currentVersion < SCHEMA_VERSION) {
      db.executeSync('PRAGMA journal_mode = WAL');
      db.executeSync('PRAGMA foreign_keys = ON');

      db.executeSync(`
        CREATE TABLE IF NOT EXISTS places (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          address TEXT,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          radius REAL NOT NULL DEFAULT 50,
          category TEXT,
          visit_count INTEGER DEFAULT 1,
          total_duration INTEGER DEFAULT 0,
          first_visit INTEGER NOT NULL,
          last_visit INTEGER NOT NULL,
          is_geofenced INTEGER DEFAULT 0
        )
      `);

      db.executeSync(`
        CREATE TABLE IF NOT EXISTS segments (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          start_time INTEGER NOT NULL,
          end_time INTEGER NOT NULL,
          activity TEXT NOT NULL,
          distance REAL,
          place_id TEXT,
          date TEXT NOT NULL
        )
      `);

      db.executeSync(`
        CREATE TABLE IF NOT EXISTS gps_points (
          id TEXT PRIMARY KEY,
          segment_id TEXT NOT NULL,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          altitude REAL DEFAULT 0,
          accuracy REAL DEFAULT 0,
          speed REAL DEFAULT 0,
          heading REAL DEFAULT 0,
          timestamp INTEGER NOT NULL,
          battery_level REAL,
          is_moving INTEGER DEFAULT 0,
          activity TEXT DEFAULT 'unknown',
          confidence INTEGER DEFAULT 0,
          FOREIGN KEY (segment_id) REFERENCES segments(id) ON DELETE CASCADE
        )
      `);

      db.executeSync(`
        CREATE TABLE IF NOT EXISTS simplified_points (
          segment_id TEXT NOT NULL,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          sort_order INTEGER NOT NULL,
          FOREIGN KEY (segment_id) REFERENCES segments(id) ON DELETE CASCADE
        )
      `);

      db.executeSync(`
        CREATE TABLE IF NOT EXISTS day_logs (
          date TEXT PRIMARY KEY,
          total_distance REAL DEFAULT 0,
          total_moving_time INTEGER DEFAULT 0,
          total_stationary_time INTEGER DEFAULT 0,
          places_visited INTEGER DEFAULT 0,
          activity_breakdown TEXT DEFAULT '{}'
        )
      `);

      db.executeSync(`
        CREATE TABLE IF NOT EXISTS geofenced_places (
          place_id TEXT PRIMARY KEY
        )
      `);

      db.executeSync('CREATE INDEX IF NOT EXISTS idx_segments_date ON segments(date)');
      db.executeSync('CREATE INDEX IF NOT EXISTS idx_gps_points_segment ON gps_points(segment_id)');
      db.executeSync('CREATE INDEX IF NOT EXISTS idx_simplified_segment ON simplified_points(segment_id)');
      db.executeSync('CREATE INDEX IF NOT EXISTS idx_places_location ON places(latitude, longitude)');

      db.executeSync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      console.log(`[DB] Migrated to schema v${SCHEMA_VERSION}`);
    }
  }

  private getDb(): DB {
    if (!this.db) throw new Error('Database not initialized');
    return this.db;
  }

  // ── Places ──

  async upsertPlace(place: Place): Promise<void> {
    const db = this.getDb();
    await db.execute(
      `INSERT INTO places (id, name, address, latitude, longitude, radius, category, visit_count, total_duration, first_visit, last_visit, is_geofenced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         address = excluded.address,
         latitude = excluded.latitude,
         longitude = excluded.longitude,
         radius = excluded.radius,
         category = excluded.category,
         visit_count = excluded.visit_count,
         total_duration = excluded.total_duration,
         last_visit = excluded.last_visit,
         is_geofenced = excluded.is_geofenced`,
      [
        place.id,
        place.name,
        place.address ?? null,
        place.latitude,
        place.longitude,
        place.radius,
        place.category ?? null,
        place.visitCount,
        place.totalDuration,
        place.firstVisit,
        place.lastVisit,
        place.isGeofenced ? 1 : 0,
      ],
    );
  }

  async getAllPlaces(): Promise<Place[]> {
    const db = this.getDb();
    const result = await db.execute('SELECT * FROM places');
    return result.rows.map(rowToPlace);
  }

  async getPlace(id: string): Promise<Place | undefined> {
    const db = this.getDb();
    const result = await db.execute('SELECT * FROM places WHERE id = ?', [id]);
    return result.rows.length > 0 ? rowToPlace(result.rows[0]) : undefined;
  }

  // ── Segments & Points ──

  async insertSegment(segment: Segment, dateKey: string): Promise<void> {
    const db = this.getDb();
    await db.transaction(async tx => {
      await tx.execute(
        `INSERT OR REPLACE INTO segments (id, type, start_time, end_time, activity, distance, place_id, date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          segment.id,
          segment.type,
          segment.startTime,
          segment.endTime,
          segment.activity,
          segment.distance ?? null,
          segment.place?.id ?? null,
          dateKey,
        ],
      );

      if (segment.points.length > 0) {
        const pointBatch: [string, any[]][] = segment.points.map(p => [
          `INSERT OR REPLACE INTO gps_points (id, segment_id, latitude, longitude, altitude, accuracy, speed, heading, timestamp, battery_level, is_moving, activity, confidence)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            p.id,
            segment.id,
            p.latitude,
            p.longitude,
            p.altitude,
            p.accuracy,
            p.speed,
            p.heading,
            p.timestamp,
            p.batteryLevel ?? null,
            p.isMoving ? 1 : 0,
            p.activity,
            p.confidence,
          ],
        ]);

        for (const [query, params] of pointBatch) {
          await tx.execute(query, params);
        }
      }

      if (segment.simplifiedPoints && segment.simplifiedPoints.length > 0) {
        await tx.execute('DELETE FROM simplified_points WHERE segment_id = ?', [segment.id]);
        for (let i = 0; i < segment.simplifiedPoints.length; i++) {
          const sp = segment.simplifiedPoints[i];
          await tx.execute(
            'INSERT INTO simplified_points (segment_id, latitude, longitude, sort_order) VALUES (?, ?, ?, ?)',
            [segment.id, sp.latitude, sp.longitude, i],
          );
        }
      }
    });
  }

  async getSegmentsByDate(date: string): Promise<Segment[]> {
    const db = this.getDb();
    const segResult = await db.execute(
      'SELECT * FROM segments WHERE date = ? ORDER BY start_time',
      [date],
    );

    const segments: Segment[] = [];
    for (const row of segResult.rows) {
      const segmentId = row.id as string;

      const pointsResult = await db.execute(
        'SELECT * FROM gps_points WHERE segment_id = ? ORDER BY timestamp',
        [segmentId],
      );
      const points: GpsPoint[] = pointsResult.rows.map(rowToGpsPoint);

      let simplifiedPoints: { latitude: number; longitude: number }[] | undefined;
      const spResult = await db.execute(
        'SELECT latitude, longitude FROM simplified_points WHERE segment_id = ? ORDER BY sort_order',
        [segmentId],
      );
      if (spResult.rows.length > 0) {
        simplifiedPoints = spResult.rows.map(r => ({
          latitude: r.latitude as number,
          longitude: r.longitude as number,
        }));
      }

      let place: Place | undefined;
      if (row.place_id) {
        place = await this.getPlace(row.place_id as string);
      }

      segments.push({
        id: segmentId,
        type: row.type as 'trip' | 'visit',
        startTime: row.start_time as number,
        endTime: row.end_time as number,
        activity: row.activity as ActivityType,
        points,
        simplifiedPoints,
        distance: row.distance as number | undefined,
        place,
      });
    }

    return segments;
  }

  // ── Day Logs ──

  async upsertDayLog(log: DayLog): Promise<void> {
    const db = this.getDb();
    await db.execute(
      `INSERT INTO day_logs (date, total_distance, total_moving_time, total_stationary_time, places_visited, activity_breakdown)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         total_distance = excluded.total_distance,
         total_moving_time = excluded.total_moving_time,
         total_stationary_time = excluded.total_stationary_time,
         places_visited = excluded.places_visited,
         activity_breakdown = excluded.activity_breakdown`,
      [
        log.date,
        log.totalDistance,
        log.totalMovingTime,
        log.totalStationaryTime,
        log.placesVisited,
        JSON.stringify(log.activityBreakdown),
      ],
    );
  }

  async getDayLog(date: string): Promise<DayLog | null> {
    const db = this.getDb();
    const result = await db.execute('SELECT * FROM day_logs WHERE date = ?', [date]);
    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const segments = await this.getSegmentsByDate(date);

    return {
      date: row.date as string,
      segments,
      totalDistance: row.total_distance as number,
      totalMovingTime: row.total_moving_time as number,
      totalStationaryTime: row.total_stationary_time as number,
      placesVisited: row.places_visited as number,
      activityBreakdown: JSON.parse(
        (row.activity_breakdown as string) || '{}',
      ),
    };
  }

  // ── Geofenced Places ──

  async addGeofencedPlace(placeId: string): Promise<void> {
    const db = this.getDb();
    await db.execute(
      'INSERT OR IGNORE INTO geofenced_places (place_id) VALUES (?)',
      [placeId],
    );
  }

  async getGeofencedPlaceIds(): Promise<string[]> {
    const db = this.getDb();
    const result = await db.execute('SELECT place_id FROM geofenced_places');
    return result.rows.map(r => r.place_id as string);
  }

  // ── Dev: clear all data for a date ──

  async clearDate(date: string): Promise<number> {
    const db = this.getDb();
    const segIds = await db.execute(
      'SELECT id FROM segments WHERE date = ?',
      [date],
    );
    const ids = segIds.rows.map(r => r.id as string);
    for (const id of ids) {
      await db.execute('DELETE FROM gps_points WHERE segment_id = ?', [id]);
      await db.execute('DELETE FROM simplified_points WHERE segment_id = ?', [id]);
    }
    await db.execute('DELETE FROM segments WHERE date = ?', [date]);
    await db.execute('DELETE FROM day_logs WHERE date = ?', [date]);
    return ids.length;
  }
}

function rowToPlace(row: Record<string, any>): Place {
  return {
    id: row.id,
    name: row.name,
    address: row.address ?? undefined,
    latitude: row.latitude,
    longitude: row.longitude,
    radius: row.radius,
    category: row.category ?? undefined,
    visitCount: row.visit_count,
    totalDuration: row.total_duration,
    firstVisit: row.first_visit,
    lastVisit: row.last_visit,
    isGeofenced: row.is_geofenced === 1,
  };
}

function rowToGpsPoint(row: Record<string, any>): GpsPoint {
  return {
    id: row.id,
    latitude: row.latitude,
    longitude: row.longitude,
    altitude: row.altitude ?? 0,
    accuracy: row.accuracy ?? 0,
    speed: row.speed ?? 0,
    heading: row.heading ?? 0,
    timestamp: row.timestamp,
    batteryLevel: row.battery_level ?? undefined,
    isMoving: row.is_moving === 1,
    activity: row.activity ?? 'unknown',
    confidence: row.confidence ?? 0,
  };
}

export const database = new Database();
