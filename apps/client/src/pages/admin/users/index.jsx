// src/pages/admin/users/index.jsx
import React,{ useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query"; // ✅ Corrected import
import { toast } from "react-toastify";
import {
  useFilters,
  useGlobalFilter,
  usePagination,
  useTable,
} from "react-table";
import { useUser } from "../../../store/session";

// Placeholder for ResetPassword component
const ResetPassword = ({ user }) => {
  return (
    <button
      type="button"
      className="inline-flex items-center px-4 py-1.5 border font-semibold border-gray-300 shadow-sm text-xs rounded text-white bg-blue-700 hover:bg-blue-500"
      onClick={() => toast.info(`Reset password for ${user.email} (placeholder)`)}
    >
      Reset Password
    </button>
  );
};

// Placeholder for UpdateUserModal component
const UpdateUserModal = ({ user, refetch }) => {
  return (
    <button
      type="button"
      className="inline-flex items-center px-4 py-1.5 border font-semibold border-gray-300 shadow-sm text-xs rounded text-white bg-green-700 hover:bg-green-500"
      onClick={() => {
        toast.info(`Update user ${user.email} (placeholder)`);
        refetch();
      }}
    >
      Update
    </button>
  );
};

const fetchUsers = async (fetchWithAuth) => {
  const res = await fetchWithAuth("/v1/user/all", {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Failed to fetch users: ${res.statusText}`);
  const data = await res.json();
  if (data.success === false) {
    throw new Error(data.error || "Failed to fetch users");
  }
  return data;
};

const DefaultColumnFilter = ({ column: { filterValue, setFilter } }) => {
  return (
    <input
      className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md"
      type="text"
      value={filterValue || ""}
      autoComplete="off"
      onChange={(e) => {
        setFilter(e.target.value || undefined);
      }}
      placeholder="Type to filter"
    />
  );
};

// src/pages/admin/users/index.jsx (Table component)
const Table = ({ columns, data }) => {
  const filterTypes = useMemo(
    () => ({
      text: (rows, id, filterValue) =>
        rows.filter((row) => {
          const rowValue = row.values[id];
          return rowValue !== undefined
            ? String(rowValue)
                .toLowerCase()
                .startsWith(String(filterValue).toLowerCase())
            : true;
        }),
    }),
    []
  );

  const defaultColumn = useMemo(
    () => ({
      Filter: DefaultColumnFilter,
    }),
    []
  );

  const {
    getTableProps,
    getTableBodyProps,
    headerGroups,
    page,
    prepareRow,
    canPreviousPage,
    canNextPage,
    pageCount,
    gotoPage,
    nextPage,
    previousPage,
    setPageSize,
    state: { pageIndex, pageSize },
  } = useTable(
    {
      columns,
      data,
      defaultColumn,
      filterTypes,
      initialState: {
        pageIndex: 0,
      },
    },
    useFilters,
    useGlobalFilter,
    usePagination
  );

  return (
    <div className="overflow-x-auto md:-mx-6 lg:-mx-8">
      <div className="py-2 align-middle inline-block min-w-full md:px-6 lg:px-8">
        <div className="shadow overflow-hidden border-b border-gray-200 md:rounded-lg">
          <table
            {...getTableProps()}
            className="min-w-full divide-y divide-gray-200"
          >
            <thead className="bg-gray-50">
              {headerGroups.map((headerGroup) => {
                const { key: headerGroupKey, ...headerGroupProps } = headerGroup.getHeaderGroupProps();

                return (
                  <tr
                    key={headerGroupKey || headerGroup.headers.map((header) => header.id).join("-")}
                    {...headerGroupProps}
                  >
                    {headerGroup.headers.map((column) => {
                      const { key: columnKey, ...columnProps } = column.getHeaderProps();

                      return (
                        <th
                          key={columnKey || column.id}
                          {...columnProps}
                          className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          {column.render("Header")}
                          <div>
                            {column.canFilter ? column.render("Filter") : null}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                );
              })}
            </thead>
            <tbody {...getTableBodyProps()}>
              {page.map((row) => {
                prepareRow(row);
                const { key: rowKey, ...rowProps } = row.getRowProps();

                return (
                  <tr key={rowKey || row.id} {...rowProps} className="bg-white">
                    {row.cells.map((cell) => {
                      const { key: cellKey, ...cellProps } = cell.getCellProps();

                      return (
                        <td
                          key={cellKey || `${row.id}-${cell.column.id}`}
                          className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900"
                          {...cellProps}
                        >
                          {cell.render("Cell")}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {data.length > 10 && (
            <nav
              className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6"
              aria-label="Pagination"
            >
              <div className="hidden sm:block">
                <div className="flex flex-row flex-nowrap w-full space-x-2">
                  <label
                    htmlFor="location"
                    className="block text-sm font-medium text-gray-700 mt-4"
                  >
                    Show
                  </label>
                  <select
                    id="location"
                    name="location"
                    className="block w-full pl-3 pr-10 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                    }}
                  >
                    {[10, 20, 30, 40, 50].map((pageSize) => (
                      <option key={pageSize} value={pageSize}>
                        {pageSize}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex-1 flex justify-between sm:justify-end">
                <button
                  className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                  type="button"
                  onClick={() => previousPage()}
                  disabled={!canPreviousPage}
                >
                  Previous
                </button>
                <button
                  className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                  type="button"
                  onClick={() => nextPage()}
                  disabled={!canNextPage}
                >
                  Next
                </button>
              </div>
            </nav>
          )}
        </div>
      </div>
    </div>
  );
};
const Users = () => {
  const navigate = useNavigate();
  const { fetchWithAuth } = useUser();
  const { data, status, refetch } = useQuery({
    queryKey: ["fetchAuthUsers"],
    queryFn: () => fetchUsers(fetchWithAuth),
    onError: (error) => {
      toast.error(`Error fetching users: ${error.message}`, {
        toastId: "fetch-users-error",
        autoClose: 5000,
      });
      navigate("/auth/login");
    },
  });

  async function deleteUser(id) {
    try {
      const response = await fetchWithAuth(`/v1/users/${id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
      });
      if (!response.ok) throw new Error(`Failed to delete user: ${response.statusText}`);
      const data = await response.json();
      if (data.success) {
        toast.success("User deleted successfully");
        refetch();
      } else {
        throw new Error(data.error || "Failed to delete user");
      }
    } catch (error) {
      toast.error(`Error deleting user: ${error.message}`, {
        toastId: "delete-user-error",
        autoClose: 5000,
      });
    }
  }

  const columns = useMemo(
    () => [
      {
        Header: "Name",
        accessor: "name",
        width: 10,
        id: "name",
      },
      {
        Header: "Email",
        accessor: "email",
        id: "email",
      },
      {
        Header: "",
        id: "actions",
        Cell: ({ row }) => (
          <div className="space-x-4 flex flex-row">
            <UpdateUserModal user={row.original} refetch={refetch} />
            <ResetPassword user={row.original} />
            {row.original.isAdmin ? null : (
              <button
                type="button"
                onClick={() => deleteUser(row.original.id)}
                className="inline-flex items-center px-4 py-1.5 border font-semibold border-gray-300 shadow-sm text-xs rounded text-white bg-red-700 hover:bg-red-500"
              >
                Delete
              </button>
            )}
          </div>
        ),
      },
    ],
    [refetch]
  );

  return (
    <main className="flex-1">
      <div className="relative max-w-4xl mx-auto md:px-8 xl:px-0">
        <div className="pt-10 pb-16 divide-y-2">
          <div className="px-4 sm:px-6 md:px-0">
            <h1 className="text-3xl font-extrabold text-gray-900">
              Internal Users
            </h1>
          </div>
          <div className="px-4 sm:px-6 md:px-0">
            <div className="sm:flex sm:items-center">
              <div className="sm:flex-auto mt-4">
                <p className="mt-2 text-sm text-gray-700">
                  A list of all internal users of your instance.
                </p>
              </div>
              <div className="sm:ml-16 mt-5 sm:flex-none">
                <Link
                  to="/admin/users/new"
                  className="rounded bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
                >
                  New User
                </Link>
              </div>
            </div>
            <div className="py-4">
              {status === "pending" && (
                <div className="min-h-screen flex flex-col justify-center items-center py-12 sm:px-6 lg:px-8">
                  <h2>Loading data...</h2>
                </div>
              )}
              {status === "error" && (
                <div className="min-h-screen flex flex-col justify-center items-center py-12 sm:px-6 lg:px-8">
                  <h2 className="text-2xl font-bold">Error fetching data...</h2>
                </div>
              )}
              {status === "success" && (
                <div>
                  <div className="hidden sm:block">
                    <Table columns={columns} data={data.users || []} />
                  </div>
                  <div className="sm:hidden">
                    {data.users?.map((user, index) => (
                      <div
                        key={user.id || user._id || user.email || index}
                        className="flex flex-col text-center bg-white rounded-lg shadow mt-4"
                      >
                        <div className="flex-1 flex flex-col p-8">
                          <h3 className="text-gray-900 text-sm font-medium">
                            {user.name}
                          </h3>
                          <dl className="mt-1 flex-grow flex flex-col justify-between">
                            <dd className="text-gray-500 text-sm">
                              {user.email}
                            </dd>
                            <dt className="sr-only">Role</dt>
                            <dd className="mt-3">
                              <span className="px-2 py-1 text-green-800 text-xs font-medium bg-green-100 rounded-full">
                                {user.isAdmin ? "admin" : "user"}
                              </span>
                            </dd>
                          </dl>
                        </div>
                        <div className="space-x-4 flex flex-row justify-center -mt-8 mb-4">
                          <UpdateUserModal user={user} refetch={refetch} />
                          <ResetPassword user={user} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
};

export default Users;
