// Admin audit log viewer

import {
  Button,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  tokens,
} from '@fluentui/react-components';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

export function AdminAudit() {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-audit', page],
    queryFn: () => api.adminAuditLog(page),
  });

  const totalPages = data ? Math.ceil(data.total / 50) : 1;
  const logs = data?.logs as Array<{
    id: string;
    username?: string;
    action: string;
    resource_type?: string;
    resource_id?: string;
    ip_address?: string;
    created_at: number;
  }> ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {isLoading ? (
        <Spinner />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Time</TableHeaderCell>
              <TableHeaderCell>User</TableHeaderCell>
              <TableHeaderCell>Action</TableHeaderCell>
              <TableHeaderCell>Resource</TableHeaderCell>
              <TableHeaderCell>IP</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.map((log) => (
              <TableRow key={log.id}>
                <TableCell style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                  {new Date(log.created_at * 1000).toLocaleString()}
                </TableCell>
                <TableCell>
                  <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {log.username ? `@${log.username}` : '—'}
                  </Text>
                </TableCell>
                <TableCell>
                  <Text style={{ fontFamily: 'monospace', fontSize: 12, color: tokens.colorBrandForeground1 }}>
                    {log.action}
                  </Text>
                </TableCell>
                <TableCell style={{ fontSize: 12 }}>
                  {log.resource_type && <span style={{ color: tokens.colorNeutralForeground3 }}>{log.resource_type}/</span>}
                  {log.resource_id?.slice(0, 12) ?? '—'}
                </TableCell>
                <TableCell style={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {log.ip_address ?? '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
          <Button size="small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <Text size={200}>{page} / {totalPages}</Text>
          <Button size="small" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
